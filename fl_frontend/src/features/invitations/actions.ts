"use server";

import { isFreshlySignedIn } from "@/core/auth/sessionStamps";
import { frontend_config } from "@/core/config";
import { isRecordMissing } from "@/core/errors";
import { invitationLink } from "@/core/invitationEmail";
import { KONTAKTE_ABSCHNITT } from "@/features/teams/constants";
import { getTeamSaisons } from "@/features/teams/queries";
import { refusalResult, refuseUnconfirmed, runAdminMutation } from "@/shared/utils/adminMutation";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors, VALIDATION_FAILED } from "@/shared/utils/validation";

import { deleteInvitation, mailInvitation, postInvitation } from "./mutations";
import { getInvitation } from "./queries";
import { mapInvitationRefusal } from "./refusals";
import { InvitationKeySchema, InvitationMailSchema } from "./schemas";
import { addressSentence } from "./sentences";

import type { ActionResult } from "@/shared/types/types";
import type { z } from "zod";

/**
 * Mints the team's link for the season, closing any live one in the same transaction. **The raw link
 * value is answered once and stored nowhere**, so the panel showing it holds the only copy an
 * administrator will ever see.
 */
export async function postInvitationAction(
  rawPayload: z.input<typeof InvitationKeySchema>,
): Promise<ActionResult<{ invitation_id: string; token: string; link: string }>> {
  return runAdminMutation("postInvitationAction", async (session) => {
    const validated = InvitationKeySchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    // A mint voiding a standing link is a step-up write and the first mint is not, so a read decides; made
    // only for a session past the window, the one it can refuse.
    const standing = isFreshlySignedIn(session) ? null : (await getInvitation(validated.data.team_id, validated.data.saison_id)).invitation;
    const unconfirmed = standing === null ? null : refuseUnconfirmed(session);
    if (unconfirmed !== null) return unconfirmed;

    let mintOperation;
    try {
      mintOperation = await postInvitation(validated.data);
    } catch (error) {
      const refusal = mapInvitationRefusal(error);
      if (refusal !== null) return refusalResult(refusal);
      throw error;
    }

    return {
      success: true,
      invitation_id: mintOperation.invitation_id,
      token: mintOperation.token,
      // Spelled here and never in the panel: `frontend_config.AUTH_URL` is server-only, and a link
      // built in the browser would carry whichever host the page was opened on.
      link: invitationLink(new URL(frontend_config.AUTH_URL).origin, mintOperation.token),
      message: "Der neue Link gilt ab sofort. Ein vorheriger Link öffnet nichts mehr.",
    };
  });
}

/**
 * Owes the team's live link to its confirmed contact seats. **A second press, never part of the mint**: the link is
 * shown for copying first, and this is what puts it in an inbox. Each mail mints a link of its own when it leaves, so
 * the copied one stays valid beside them.
 */
export async function mailInvitationAction(rawPayload: z.input<typeof InvitationMailSchema>): Promise<ActionResult> {
  return runAdminMutation("mailInvitationAction", { stepUp: true }, async () => {
    const validated = InvitationMailSchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    const { team_id, saison_id } = validated.data;
    const memberships = await getTeamSaisons();
    const membership =
      memberships.teams.find((candidate) => candidate.id === team_id)?.memberships.find((candidate) => candidate.saison_id === saison_id) ??
      null;

    if (membership?.kontakte == null) {
      return {
        success: false,
        error: buildRefusal({
          reason: "Für dieses Team sind in dieser Saison keine Kontaktdaten hinterlegt",
          repair: { before: "Trage sie", after: "ein, oder gib den Link von Hand weiter" },
          where: KONTAKTE_ABSCHNITT,
        }),
      };
    }

    let versandOperation;
    try {
      versandOperation = await mailInvitation(validated.data);
    } catch (error) {
      // A panel left open while somebody else replaced or withdrew the link names a row that opens nothing.
      if (isRecordMissing(error)) {
        return {
          success: false,
          error: buildRefusal({
            reason: "Dieser Link ist nicht mehr der offene Link dieses Teams",
            repair: "Lade die Seite neu und lege einen neuen Link an",
          }),
        };
      }
      throw error;
    }

    const gesamt = versandOperation.recipient.length;
    if (gesamt === 0) {
      return {
        success: false,
        error: buildRefusal({
          reason: "Keine Kontaktperson dieses Teams hat ihre Daten bisher selbst bestätigt",
          repair: "Warte auf eine Bestätigung, oder gib den Link von Hand weiter",
        }),
      };
    }

    return { success: true, message: addressSentence(gesamt, gesamt) };
  });
}

/** Closes the team's live link. Nothing reverses it: the next link is a fresh mint with a fresh value. */
export async function deleteInvitationAction(rawPayload: z.input<typeof InvitationKeySchema>): Promise<ActionResult> {
  return runAdminMutation("deleteInvitationAction", { stepUp: true }, async () => {
    const validated = InvitationKeySchema.safeParse(rawPayload);

    if (!validated.success) {
      return { success: false, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(validated.error) };
    }

    await deleteInvitation(validated.data);

    return { success: true, message: "Der Link öffnet ab sofort nichts mehr." };
  });
}
