import { revalidateTag } from "next/cache";

import { saveMayMint } from "@/features/schiedsrichter/linkMint";
import { patchSchiedsrichter } from "@/features/schiedsrichter/mutations";
import { describeLinkMail, mailSchiedsrichterLink } from "@/features/schiedsrichter/notifications";
import { getSchiedsrichterById } from "@/features/schiedsrichter/queries";
import { SCHIEDSRICHTER_REPLAY_REFUSALS } from "@/features/schiedsrichter/refusals";
import { FLPatchSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSchiedsrichterEdit",
    schema: FLPatchSchiedsrichterPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSchiedsrichter(payload);
      } catch (error) {
        return refusedReplay(error, SCHIEDSRICHTER_REPLAY_REFUSALS);
      }

      if (!operation.acknowledged) {
        return { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die Schiedsrichterdaten." };
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
    // The replay is a save, its mint judged as the save's own action judges one: without this the route
    // is a second door to that save with no step-up (`docs/frontend/spec.md :: I432`).
    stepUp: async (payload) => {
      const stored = await getSchiedsrichterById(payload.id);
      return stored !== null && saveMayMint(stored.schiedsrichter, payload.kontakt.email);
    },
  });
}
