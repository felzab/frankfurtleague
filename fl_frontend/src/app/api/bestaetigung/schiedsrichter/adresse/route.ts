import z from "zod";

import { postSchiedsrichterAdresswechsel, postSchiedsrichterAdresswechselStopp } from "@/features/schiedsrichter/mutations";
import { mailSchiedsrichterAdresswechselWirksam } from "@/features/schiedsrichter/notifications";
import { mapSchiedsrichterAdresswechselRefusal } from "@/features/schiedsrichter/queries";
import {
  FLSchiedsrichterAdresswechselAntwortPayloadSchema,
  FLSchiedsrichterAdresswechselStoppPayloadSchema,
} from "@/features/schiedsrichter/schemas";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { NextRequest } from "next/server";

/** The page's three presses: the new mailbox's two answers, and the stop of the address on file, one page serving both links. */
const PresseSchema = z.union([
  FLSchiedsrichterAdresswechselAntwortPayloadSchema,
  FLSchiedsrichterAdresswechselStoppPayloadSchema.extend({ antwort: z.literal("gestoppt") }),
]);

// A route handler and POST alone, for the consent link's reasons (`docs/frontend/spec.md` §1.3): a
// mail scanner's GET must not answer for the person whether a mailbox is theirs, nor stop a change.
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postSchiedsrichterAdresswechsel",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      const parsed = PresseSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      const presse = parsed.data;
      let antwort;
      try {
        if (presse.antwort === "gestoppt") {
          await postSchiedsrichterAdresswechselStopp({ token: presse.token });
          return { success: true as const, antwort: presse.antwort, wirksam_ab: null };
        }
        antwort = await postSchiedsrichterAdresswechsel(presse);
      } catch (error) {
        // The link dying between the open and the press is a panel, never the error page.
        const refusal = mapSchiedsrichterAdresswechselRefusal(error);
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // The replaced address and its first name reach this handler alone: a leaked link learns only
      // what it posted, so neither travels on to the browser (`docs/frontend/spec.md :: I629`).
      if (antwort.mitteilung !== null)
        await mailSchiedsrichterAdresswechselWirksam({ operation: "postSchiedsrichterAdresswechsel", mitteilung: antwort.mitteilung });

      // No cache moves: no cached read holds a referee's address.
      return { success: true as const, antwort: antwort.antwort, wirksam_ab: antwort.wirksam_ab };
    },
  });
}
