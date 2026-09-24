import { revalidateTag } from "next/cache";

import { patchSchiedsrichter } from "@/features/schiedsrichter/mutations";
import { describeLinkMail, mailSchiedsrichterLink } from "@/features/schiedsrichter/notifications";
import { FLPatchSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { KONFLIKT_MIT_BESTEHENDEM } from "@/shared/utils/actionError";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/** Worded for the undo: the save's own sentences send an admin to a form this toast has not got. */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-SCHIEDSRICHTER-007":
    "Die frühere E-Mail-Adresse steht auf der Sperrliste, und zurückschreiben würde ihr einen neuen Bestätigungslink schicken.",
  "DB-COMMON-002": KONFLIKT_MIT_BESTEHENDEM,
};

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSchiedsrichterEdit",
    schema: FLPatchSchiedsrichterPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSchiedsrichter(payload);
      } catch (error) {
        return refusedReplay(error, REPLAY_REFUSALS);
      }

      if (!operation.acknowledged) {
        return { refusal: "Die Änderung steht weiterhin. Die Rücknahme wurde abgebrochen; prüfe die Schiedsrichterdaten." };
      }

      // The replay puts the earlier address back, which the endpoint reads as a correction and mints
      // for: unmailed, that token exists in the database alone and the referee's own link is dead.
      const mint = operation.bestaetigung;
      if (mint === null) return {};

      const versand = await mailSchiedsrichterLink({
        operation: "undoAdminSchiedsrichterEdit",
        schiedsrichterId: payload.id,
        // The address the MINT names, never the payload's: the replay is the older of the two reads.
        email: mint.email,
        name: payload.name,
        mint: mint,
        anlass: "erneut",
      });

      // A cost either way: the undo silently replaced a live link, which is a fact about the person
      // rather than about the rows it put back.
      return { cost: describeLinkMail(mint.email, versand) };
    },
    // `spiele` alone: the rename fans out into cached fixtures embedding this row (`docs/frontend/spec.md` §1.4).
    invalidate: () => {
      revalidateTag("spiele", { expire: 0 });
    },
  });
}
