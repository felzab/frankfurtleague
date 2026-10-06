import { z } from "zod";

import { saveMayMint } from "@/features/schiedsrichter/linkMint";
import { patchSchiedsrichter } from "@/features/schiedsrichter/mutations";
import {
  describeAdresswechselMail,
  describeLinkMail,
  mailSchiedsrichterAdresswechsel,
  mailSchiedsrichterLink,
} from "@/features/schiedsrichter/notifications";
import { getSchiedsrichterById } from "@/features/schiedsrichter/queries";
import { SCHIEDSRICHTER_REPLAY_REFUSALS } from "@/features/schiedsrichter/refusals";
import { FLPatchSchiedsrichterPayloadSchema } from "@/features/schiedsrichter/schemas";
import { handleUndoRequest, refusedReplay } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

const ADRESSWECHSEL_WARTET_WEITER =
  "Die neue E-Mail-Adresse wartet weiter auf Bestätigung. Soll sie nicht gelten, verwirf die Änderung im Eintrag.";

/**
 * The stored values, and the save's own report of whether it left the waiting address: no read after
 * the replay tells that save from one that moved only the fee while an earlier change waited.
 */
const UndoRequestSchema = FLPatchSchiedsrichterPayloadSchema.extend({ adresswechsel_gespeichert: z.boolean() });

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSchiedsrichterEdit",
    schema: UndoRequestSchema,
    restore: async ({ adresswechsel_gespeichert, ...payload }) => {
      let operation;
      try {
        operation = await patchSchiedsrichter(payload);
      } catch (error) {
        return refusedReplay(error, SCHIEDSRICHTER_REPLAY_REFUSALS);
      }

      if (!operation.acknowledged) {
        return { unclear: "Die Rücknahme wurde abgebrochen. Prüfe die Schiedsrichterdaten." };
      }

      // A confirmed referee's address never moved on the save, so the replay asks the earlier address
      // again only where that change was confirmed since; unmailed, that link reaches nobody.
      const wechsel = operation.adresswechsel;
      if (wechsel !== null) {
        const wechselVersand = await mailSchiedsrichterAdresswechsel({
          operation: "undoAdminSchiedsrichterEdit",
          schiedsrichterId: payload.id,
          name: payload.name,
          mint: wechsel,
          anlass: "erneut",
        });

        return { cost: describeAdresswechselMail(wechsel.email, wechselVersand) };
      }

      // The replay writes the fields back and leaves a pending address standing, its link already
      // in that mailbox: the discard is the editor's control, never a side effect of an undo. Said only
      // where the undone save was the one that left it, an undone fee edit having nothing to do with it.
      if (adresswechsel_gespeichert && operation.updated_document.adresswechsel !== null) return { cost: ADRESSWECHSEL_WARTET_WEITER };

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
    tags: () => ["spiele"],
    // The replay is a save, its mint judged as the save's own action judges one: without this the route
    // is a second door to that save with no step-up (`docs/frontend/spec.md :: I432`).
    stepUp: async (payload) => {
      const stored = await getSchiedsrichterById(payload.id);
      return stored !== null && saveMayMint(stored.schiedsrichter, payload.kontakt.email);
    },
  });
}
