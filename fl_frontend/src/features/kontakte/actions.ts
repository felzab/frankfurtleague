"use server";

import { isFreshlySignedIn } from "@/core/auth";
import { getLaufendesLabel } from "@/core/einwilligung";
import { describeLinkMail } from "@/features/schiedsrichter/notifications";
import { getTeamMemberships } from "@/features/teams/queries";
import { refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { refusedReplay, replayRefusal, restored, runAdminUndo, unclearReplay, UNDO_UNREADABLE } from "@/shared/utils/adminUndo";
import { schlechtesterVersand } from "@/shared/utils/linkVersand";
import { buildRefusal, VERSUCHE_ES_ERNEUT } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { kontakteMayMoveLinks } from "./linkMint";
import { einladeKontakt, patchSaisonTeamKontakte } from "./mutations";
import { describeKontaktVersand, mailKontaktAbgang, mailKontaktLink } from "./notifications";
import { KONTAKTE_REPLAY_REFUSALS, mapEinladenRefusal, mapKontakteRefusal, STALE_BLOCK_REFUSAL } from "./refusals";
import { FLKontaktEinladenPayloadSchema, FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas";
import { mitLaufenderFassung } from "./utils";

import type { FLSaisonTeamKontakte } from "@/features/teams/schemas";
import type { ActionResult } from "@/shared/types/types";
import type { UndoOutcome } from "@/shared/utils/adminUndo";
import type { LinkVersand } from "@/shared/utils/linkVersand";
import type { KontaktVersand } from "./notifications";
import type { FLKontaktEinladenPayload, FLPatchSaisonTeamKontaktePayload, FLPatchSaisonTeamKontakteResponse } from "./schemas";

/** What the editor reads off a save: the block as stored and the token an undo of it carries. */
type KontakteGespeichert = Pick<FLPatchSaisonTeamKontakteResponse, "kontakte" | "kontakte_stand">;

/**
 * The three seats one club holds for one season, written whole. The season's competition facts stay
 * on `PATCH /teams/{team_id}/saisons/{saison_id}`: they answer a different question and belong to a
 * different page.
 */
export async function patchSaisonTeamKontakteAction(
  // Composed by the caller: the editor's own guard refuses a body before this is reached, and a
  // field no control renders is a block with no repair.
  rawPayload: FLPatchSaisonTeamKontaktePayload,
  // The send's outcome beside the sentence rather than one the caller parses: the editor grades its
  // toast on it, and the save landed either way.
): Promise<ActionResult<{ saison_team?: KontakteGespeichert; versandSatz?: string; versand?: LinkVersand }>> {
  return runAdminMutation("patchSaisonTeamKontakteAction", async (session) => {
    const validated = FLPatchSaisonTeamKontaktePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // A save minting or voiding a link is a step-up write, and one moving none keeps its undo
    // (`docs/frontend/spec.md :: I432`). The stored row is read only for a session past the window.
    const movesLinks =
      validated.data.kontakte !== null &&
      !isFreshlySignedIn(session) &&
      kontakteMayMoveLinks(await gespeicherteKontakte(validated.data), validated.data.kontakte);
    const unconfirmed = validated.data.kontakte === null || movesLinks ? refuseUnconfirmed(session) : null;
    if (unconfirmed !== null) return unconfirmed;

    // `validated.data` and never `rawPayload`, whose type is a promise the wire does not keep.
    // The refusal belongs on the page that asked, not on the error page.
    let saisonTeam;
    try {
      // Read at the write, never off the page: a deploy between the editor's open and this press
      // moves the label a new acceptance names.
      const kontakte =
        validated.data.kontakte === null ? null : mitLaufenderFassung(validated.data.kontakte, await getLaufendesLabel("bewerbung"));
      saisonTeam = await patchSaisonTeamKontakte({ ...validated.data, kontakte });
    } catch (error) {
      const refusal = mapKontakteRefusal(error);
      if (refusal !== null) return { success: false, error: refusal };
      throw error;
    }

    if (!saisonTeam.acknowledged) {
      return { success: false, error: buildRefusal({ reason: "Die Kontakte wurden nicht gespeichert", repair: VERSUCHE_ES_ERNEUT }) };
    }

    // No tag moves: no cached read holds a contact person.
    // `fl_frontend/src/features/teams/queries.ts :: getTeamMemberships` is memoised per render pass
    // and not across requests, no public team read carries `kontakte`, and the admin's own list is
    // uncached.

    // Read here and never returned: the result reaches the browser, which holds no address the save took off.
    const abgaenge = Promise.all(
      saisonTeam.abgaenge.map((abgang) =>
        mailKontaktAbgang({
          operation: "patchSaisonTeamKontakteAction",
          saisonTeamId: saisonTeam.saison_team_id,
          saisonId: saisonTeam.saison_id,
          abgang: abgang,
        }),
      ),
    );
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
    await abgaenge;

    return {
      success: true,
      // The two fields the editor reads and nothing else: an action's result reaches the browser, and
      // the answer beside them carries every minted link's raw token (`docs/backend/spec.md :: I142`).
      saison_team: { kontakte: saisonTeam.kontakte, kontakte_stand: saisonTeam.kontakte_stand },
      // The cleared block is a removal rather than a save, and it is the one outcome a reader would
      // not expect to have to check for.
      message: validated.data.kontakte === null ? "Kontakte entfernt" : "Kontakte gespeichert",
      // Its own field rather than folded into the message: the editor hands this to the undo offer,
      // and a save that mailed nothing has no sentence to hand it.
      versandSatz: describeKontaktVersand(versendet) ?? undefined,
      versand: schlechtesterVersand(versendet.map(({ versand }) => versand)),
    };
  });
}

/**
 * The save's own payload, replayed: the endpoint replaces the block whole on the row its path names.
 * The precondition beside it is the save's AFTER image, that save having moved the row past what the
 * editor read.
 */
export async function undoAdminKontakteEditAction(rawPayload: FLPatchSaisonTeamKontaktePayload): Promise<UndoOutcome> {
  return runAdminUndo("undoAdminKontakteEditAction", async (session) => {
    const validated = FLPatchSaisonTeamKontaktePayloadSchema.safeParse(rawPayload);
    if (!validated.success) return { success: false, error: UNDO_UNREADABLE };

    // The replay is a save, judged as the save judges one (`docs/frontend/spec.md :: I432`): undoing a
    // first entry clears the block, and putting an earlier person back mints a link and voids one.
    const movesLinks =
      validated.data.kontakte !== null &&
      !isFreshlySignedIn(session) &&
      kontakteMayMoveLinks(await gespeicherteKontakte(validated.data), validated.data.kontakte);
    const unconfirmed = validated.data.kontakte === null || movesLinks ? refuseUnconfirmed(session) : null;
    if (unconfirmed !== null) return unconfirmed;

    // No tag moves, as on the save: no cached read holds a contact person.
    let operation;
    try {
      // The earlier people come back as new acceptances, which name the label the form runs now
      // (`fl_frontend/src/features/kontakte/utils.ts :: mitLaufenderFassung`).
      const kontakte =
        validated.data.kontakte === null ? null : mitLaufenderFassung(validated.data.kontakte, await getLaufendesLabel("bewerbung"));
      operation = await patchSaisonTeamKontakte({ ...validated.data, kontakte });
    } catch (error) {
      const stale = replayRefusal(error, STALE_BLOCK_REFUSAL);
      return stale === undefined ? refusedReplay(error, KONTAKTE_REPLAY_REFUSALS) : { success: false, error: stale };
    }

    if (!operation.acknowledged) return unclearReplay("Die Rücknahme wurde abgebrochen. Prüfe die Kontaktdaten.");

    // The person the save seated is the one the replay takes off, and is told as the save's own leavers are.
    const abgaenge = Promise.all(
      operation.abgaenge.map((abgang) =>
        mailKontaktAbgang({
          operation: "undoAdminKontakteEditAction",
          saisonTeamId: operation.saison_team_id,
          saisonId: operation.saison_id,
          abgang: abgang,
        }),
      ),
    );
    // The replay puts an earlier person back on a seat, which the endpoint reads as newly seating
    // them and mints for: unmailed, that token exists in the database alone and the seat never confirms.
    const versendet: KontaktVersand[] = await Promise.all(
      operation.bestaetigungen.map(async (mint) => ({
        email: mint.email,
        versand: await mailKontaktLink({
          operation: "undoAdminKontakteEditAction",
          saisonTeamId: operation.saison_team_id,
          saisonId: operation.saison_id,
          mint: mint,
          anlass: "erneut",
        }),
      })),
    );
    await abgaenge;
    const versandSatz = describeKontaktVersand(versendet);

    // A cost either way: the undo mailed a person, which is a fact about them rather than about the
    // rows it put back.
    return restored(versandSatz ?? undefined);
  });
}

/**
 * A fresh link for one unconfirmed seat, the seat's earlier one opening nothing afterwards. **Always a
 * step-up write**: every call mints a bearer link.
 */
export async function einladeKontaktAction(rawPayload: FLKontaktEinladenPayload): Promise<ActionResult<{ versand: LinkVersand }>> {
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
      return { success: false, error: buildRefusal({ reason: "Der Bestätigungslink wurde nicht gesendet", repair: VERSUCHE_ES_ERNEUT }) };
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
      versand: versand,
    };
  });
}

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
