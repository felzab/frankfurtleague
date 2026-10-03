import { kontakteMayMoveLinks } from "@/features/kontakte/linkMint";
import { patchSaisonTeamKontakte } from "@/features/kontakte/mutations";
import { describeKontaktVersand, mailKontaktLink } from "@/features/kontakte/notifications";
import { FLPatchSaisonTeamKontaktePayloadSchema } from "@/features/kontakte/schemas";
import { getTeamMemberships } from "@/features/teams/queries";
import { KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError";
import { handleUndoRequest, refusedReplay, replayRefusal } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/**
 * Its own close, the one undo row without the change standing: it already says the undo did not run,
 * and why. Worded for the undo, whose toast has not got the save's form.
 */
const STALE_BLOCK_REFUSAL: Record<string, string> = {
  "REQ-KONTAKT-001":
    "Die Kontakte dieser Saison wurden nach dem Speichern erneut geändert, etwa weil eine Kontaktperson ihren Eintrag bestätigt oder ihm widersprochen hat oder gelöscht wurde. " +
    "Die Rücknahme wurde nicht ausgeführt, damit sie die neueren Angaben nicht überschreibt.",
};

const REPLAY_REFUSALS: Record<string, string> = {
  "DB-COMMON-002": KONFLIKT_MIT_BESTEHENDEM,
};

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminKontakteEdit",
    // The save's own payload, replayed: the endpoint replaces the block whole on the row its path
    // names. The precondition beside it is the save's AFTER image, that save having moved the row
    // past what the editor read.
    schema: FLPatchSaisonTeamKontaktePayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        // Each seat's consent label replayed as the earlier record stored it, never judged against the
        // save's admission (`fl_frontend/src/features/kontakte/actions.ts :: nenntZugelasseneFassungen`):
        // the save being undone has moved the stored label that admission reads.
        operation = await patchSaisonTeamKontakte(payload);
      } catch (error) {
        const stale = replayRefusal(error, STALE_BLOCK_REFUSAL);
        return stale === undefined ? refusedReplay(error, REPLAY_REFUSALS) : { refusal: stale };
      }

      if (!operation.acknowledged) return { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die Kontaktdaten." };

      // The replay puts an earlier person back on a seat, which the endpoint reads as newly seating
      // them and mints for: unmailed, that token exists in the database alone and the seat never confirms.
      const versendet = await Promise.all(
        operation.bestaetigungen.map(async (mint) => ({
          email: mint.email,
          versand: await mailKontaktLink({
            operation: "undoAdminKontakteEdit",
            saisonTeamId: operation.saison_team_id,
            saisonId: operation.saison_id,
            mint: mint,
            anlass: "erneut",
          }),
        })),
      );
      const versandSatz = describeKontaktVersand(versendet, operation.gesperrt, operation.kontakte);

      // A cost either way: the undo mailed a person, which is a fact about them rather than about the
      // rows it put back.
      return versandSatz === null ? {} : { cost: versandSatz };
    },
    // Nothing to clear, for the reason `fl_frontend/src/features/kontakte/actions.ts :: patchSaisonTeamKontakteAction`
    // states at the save this replays: no cached read holds a contact person. The screen is refreshed
    // by the caller instead.
    invalidate: () => undefined,
    // The replay is a save, judged as the save's own action judges one (`docs/frontend/spec.md :: I432`):
    // undoing a first entry clears the block, and putting an earlier person back mints a link and voids one.
    stepUp: async ({ team_id, saison_id, kontakte }) => {
      if (kontakte === null) return true;

      const { teams } = await getTeamMemberships();
      const gespeichert =
        teams.find(({ id }) => id === team_id)?.memberships.find((membership) => membership.saison_id === saison_id)?.kontakte ?? null;

      return kontakteMayMoveLinks(gespeichert, kontakte);
    },
  });
}
