"use server";

import { isFreshlySignedIn } from "@/core/auth";
import { getLaufendesLabel } from "@/core/einwilligung";
import { BEWERBUNG_VERALTET, nenntLaufendeFassung } from "@/features/bewerbungen/utils";
import { describeLinkMail } from "@/features/schiedsrichter/notifications";
import { getTeamMemberships } from "@/features/teams/queries";
import { refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { kontakteMayMint } from "./linkMint";
import { einladeKontakt, eraseKontaktperson, patchSaisonTeamKontakte, readKontaktErasureAnsicht } from "./mutations";
import { describeKontaktVersand, mailKontaktLink } from "./notifications";
import { mapEinladenRefusal, mapStaleBlockRefusal } from "./refusals";
import { FLKontaktEinladenPayloadSchema, FLKontaktErasurePayloadSchema, FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas";
import { describeKontaktErasureUmfang } from "./utils";

import type { FLSaisonTeamKontakte } from "@/features/teams/schemas";
import type { ActionResult, QueryResult } from "@/shared/types/types";
import type { KontaktVersand } from "./notifications";
import type {
  FLKontaktEinladenPayload,
  FLKontaktErasureAnsichtResponse,
  FLKontaktErasurePayload,
  FLPatchSaisonTeamKontaktePayload,
  FLPatchSaisonTeamKontakteResponse,
} from "./schemas";

/**
 * Clears one contact person from every season's junction row, every application, and the log's saved
 * images of both. **Permanent, with no undo.** It refuses nothing: a person may ask to be forgotten
 * while the club they were reached for still plays.
 */
export async function eraseKontaktpersonAction(rawPayload: FLKontaktErasurePayload): Promise<ActionResult<{ cleared?: number }>> {
  return runAdminMutation("eraseKontaktpersonAction", { stepUp: true }, async () => {
    const validated = FLKontaktErasurePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    const erasure = await eraseKontaktperson(validated.data);
    if (!erasure.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Kontaktdaten wurden nicht gelöscht", repair: "Versuche es erneut" }) };
    }

    // No tag moves: no cached read holds a contact person.
    // `fl_frontend/src/features/teams/queries.ts :: getTeamMemberships` is memoised per render pass
    // and not across requests, and no public team read carries `kontakte`. The admin's own list is
    // uncached, so no tag reaches it.

    return {
      success: true,
      /* How much was touched, so a caller can tell an erasure from a no-op: this endpoint refuses
         nothing, so an address matching nobody succeeds and clears zero. A count, never the address. */
      cleared: erasure.cleared_kontakt_slots + erasure.redacted_aktionen,
      message: describeKontaktErasureUmfang(erasure),
    };
  });
}

/**
 * The three seats one club holds for one season, written whole. The season's competition facts stay
 * on `PATCH /teams/{team_id}/saisons/{saison_id}`: they answer a different question and belong to a
 * different page.
 */
export async function patchSaisonTeamKontakteAction(
  // Composed by the caller: the editor's own guard refuses a body before this is reached, and a
  // field no control renders is a block with no repair.
  rawPayload: FLPatchSaisonTeamKontaktePayload,
  // A flag beside the sentence rather than one the caller parses: the editor grades its toast a
  // warning on it, and the save landed either way.
): Promise<ActionResult<{ saison_team?: FLPatchSaisonTeamKontakteResponse; versandSatz?: string; versandFehlgeschlagen?: boolean }>> {
  return runAdminMutation("patchSaisonTeamKontakteAction", async (session) => {
    const validated = FLPatchSaisonTeamKontaktePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // Clearing the block and a save seating somebody new are step-up writes; an edit seating nobody
    // keeps its undo (`docs/frontend/spec.md :: I432`). The stored row is read only for a session
    // past the window, the backend refusing the rest.
    const mayMint =
      validated.data.kontakte !== null &&
      !isFreshlySignedIn(session) &&
      // Judged against nobody first, so a block seating nobody costs no read.
      kontakteMayMint(null, validated.data.kontakte) &&
      kontakteMayMint(await gespeicherteKontakte(validated.data), validated.data.kontakte);
    const unconfirmed = validated.data.kontakte === null || mayMint ? refuseUnconfirmed(session) : null;
    if (unconfirmed !== null) return unconfirmed;

    // After the parse, where the application's check comes before it: only a parsed payload names
    // the row whose stored block admits its labels.
    if (!(await nenntZugelasseneFassungen(validated.data))) return { success: false, error: BEWERBUNG_VERALTET };

    // `validated.data` and never `rawPayload`, whose type is a promise the wire does not keep.
    // The refusal belongs on the page that asked, not on the error page.
    let saisonTeam;
    try {
      saisonTeam = await patchSaisonTeamKontakte(validated.data);
    } catch (error) {
      const refusal = mapStaleBlockRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!saisonTeam.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Kontakte wurden nicht gespeichert", repair: "Versuche es erneut" }) };
    }

    // No tag moves, for the erasure's reason above, and its list is uncached for the same reason.

    // One message per person this save newly seated: unmailed, a minted link sits in the database
    // alone and the seat never confirms. Together, each settling its own send and never throwing.
    const versendet: KontaktVersand[] = await Promise.all(
      saisonTeam.bestaetigungen.map(async (mint) => ({
        email: mint.email,
        versand: await mailKontaktLink({
          operation: "patchSaisonTeamKontakteAction",
          saisonTeamId: saisonTeam.saison_team_id,
          saisonId: saisonTeam.saison_id,
          mint: mint,
          anlass: "empfang",
        }),
      })),
    );

    return {
      success: true,
      saison_team: saisonTeam,
      // The cleared block is a removal rather than a save, and it is the one outcome a reader would
      // not expect to have to check for.
      message: validated.data.kontakte === null ? "Kontakte entfernt" : "Kontakte gespeichert",
      // Its own field rather than folded into the message: the editor hands this to the undo offer,
      // and a save that mailed nothing has no sentence to hand it.
      versandSatz: describeKontaktVersand(versendet, saisonTeam.gesperrt, saisonTeam.kontakte) ?? undefined,
      versandFehlgeschlagen: versendet.some(({ versand }) => versand === "fehlgeschlagen"),
    };
  });
}

/**
 * A fresh link for one unconfirmed seat, the seat's earlier one opening nothing afterwards. **Always a
 * step-up write**: every call mints a bearer link.
 */
export async function einladeKontaktAction(rawPayload: FLKontaktEinladenPayload): Promise<ActionResult<object>> {
  return runAdminMutation("einladeKontaktAction", { stepUp: true }, async () => {
    const validated = FLKontaktEinladenPayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // The refusal belongs beside the seat that asked, not on the error page.
    let mintOperation;
    try {
      mintOperation = await einladeKontakt(validated.data);
    } catch (error) {
      const refusal = mapEinladenRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!mintOperation.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Der Bestätigungslink wurde nicht gesendet", repair: "Versuche es erneut" }) };
    }

    const mint = mintOperation.bestaetigung;
    const versand = await mailKontaktLink({
      operation: "einladeKontaktAction",
      saisonTeamId: mintOperation.saison_team_id,
      saisonId: mintOperation.saison_id,
      mint: mint,
      anlass: "erneut",
    });

    return {
      success: true,
      // The address the MINT read in its own transaction, never one the page showed: a save landing
      // between the two moved the mailbox the credential was made for.
      message: describeLinkMail(mint.email, versand),
    };
  });
}

/**
 * Whom `eraseKontaktpersonAction` would clear, read before it runs. It refuses nothing: an address
 * matching nobody answers two empty lists rather than a failure the panel would have to word.
 */
export async function readKontaktErasureAnsichtAction(
  rawPayload: FLKontaktErasurePayload,
): Promise<QueryResult<{ ansicht?: FLKontaktErasureAnsichtResponse }>> {
  return runAdminMutation("readKontaktErasureAnsichtAction", async () => {
    const validated = FLKontaktErasurePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    return { success: true, ansicht: await readKontaktErasureAnsicht(validated.data) };
  });
}

const SITZE = ["trainer", "ansprechperson", "stellvertretung"] as const;

/**
 * The one read serving a stored block, memoised for the request. A block moving between it and the
 * write is refused there (`REQ-KONTAKT-001`), so the race costs a sentence rather than a stale judgement.
 */
async function gespeicherteKontakte({ team_id, saison_id }: Pick<FLPatchSaisonTeamKontaktePayload, "team_id" | "saison_id">) {
  const { teams } = await getTeamMemberships();
  const gespeichert: FLSaisonTeamKontakte | null =
    teams.find(({ id }) => id === team_id)?.memberships.find((membership) => membership.saison_id === saison_id)?.kontakte ?? null;

  return gespeichert;
}

/**
 * Admits the running label, or the one that seat already stores: the editor sends each stored seat
 * back under its own, a confirmed one under the confirmation page's.
 */
async function nenntZugelasseneFassungen({ team_id, saison_id, kontakte }: FLPatchSaisonTeamKontaktePayload): Promise<boolean> {
  const gesendet = SITZE.flatMap((rolle) => {
    const sitz = kontakte?.[rolle];
    return sitz ? [{ rolle, einwilligung: sitz.einwilligung }] : [];
  });

  // No label is read for a block naming nobody, which stamps none: clearing a block never waits on it.
  if (gesendet.length === 0) return true;
  const laufend = await getLaufendesLabel("bewerbung");

  // No read where nothing needs one: a block of new seats is judged by the running label alone.
  if (gesendet.every(({ einwilligung }) => nenntLaufendeFassung(einwilligung, laufend))) return true;

  const gespeichert = await gespeicherteKontakte({ team_id, saison_id });

  return gesendet.every(({ rolle, einwilligung }) => {
    // A mirrored Trainer is the seat it copies, sent under that seat's label.
    const quelle = rolle === "trainer" && kontakte?.trainer_ist_zugleich ? kontakte.trainer_ist_zugleich : rolle;
    const gespeicherteFassung = gespeichert?.[quelle]?.einwilligung.text_version;

    return (
      nenntLaufendeFassung(einwilligung, laufend) ||
      (gespeicherteFassung !== undefined && nenntLaufendeFassung(einwilligung, gespeicherteFassung))
    );
  });
}
