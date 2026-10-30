"use server";

import { isFreshlySignedIn } from "@/core/auth";
import { getLaufendesLabel } from "@/core/einwilligung";
import { describeLinkMail } from "@/features/schiedsrichter/notifications";
import { getTeamMemberships } from "@/features/teams/queries";
import { refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { schlechtesterVersand } from "@/shared/utils/linkVersand";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { kontakteMayMoveLinks } from "./linkMint";
import { einladeKontakt, patchSaisonTeamKontakte } from "./mutations";
import { describeKontaktVersand, mailKontaktLink } from "./notifications";
import { mapEinladenRefusal, mapKontakteRefusal } from "./refusals";
import { FLKontaktEinladenPayloadSchema, FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas";
import { mitLaufenderFassung } from "./utils";

import type { FLSaisonTeamKontakte } from "@/core/generated/client/types";
import type { ActionResult } from "@/shared/types/types";
import type { LinkVersand } from "@/shared/utils/linkVersand";
import type { KontaktVersand } from "./notifications";
import type { FLKontaktEinladenPayload, FLPatchSaisonTeamKontaktePayload } from "./schemas";

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
): Promise<ActionResult<{ versandSatz?: string; versand?: LinkVersand }>> {
  return runAdminMutation("patchSaisonTeamKontakteAction", async (session) => {
    const validated = FLPatchSaisonTeamKontaktePayloadSchema.safeParse(rawPayload);

    if (!validated.success) {
      return {
        success: false,
        error: VALIDATION_FAILED,
        fieldErrors: toFieldErrors(validated.error),
      };
    }

    // A save minting or voiding a link is a step-up write, and one moving none is not. The stored row
    // is read only for a session past the window.
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

    // No tag moves: no cached read holds a contact person.
    // `fl_frontend/src/features/teams/queries.ts :: getTeamMemberships` is memoised per render pass
    // and not across requests, no public team read carries `kontakte`, and the admin's own list is
    // uncached.

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
      // The cleared block is a removal rather than a save, and it is the one outcome a reader would
      // not expect to have to check for.
      message: validated.data.kontakte === null ? "Kontakte entfernt" : "Kontakte gespeichert",
      // Its own field rather than folded into the message: the editor's toast says it in place of the
      // save's sentence, and a save that mailed nothing has no sentence to hand it.
      versandSatz: describeKontaktVersand(versendet) ?? undefined,
      versand: schlechtesterVersand(versendet.map(({ versand }) => versand)),
    };
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
