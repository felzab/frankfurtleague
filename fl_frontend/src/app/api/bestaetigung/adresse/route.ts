// Redesign: goes with its last importer.
import z from "zod";

import { afterTheResponse } from "@/core/afterResponse";
import { kontoAnNeuerAdresse } from "@/features/adresswechsel/konto";
import { ansichtOf } from "@/features/adresswechsel/link";
import { postAdresswechselAnsicht, postAdresswechselAntwort, postAdresswechselStopp } from "@/features/adresswechsel/mutations";
import { mapAdresswechselPresseRefusal } from "@/features/adresswechsel/refusals";
import { FLAdresswechselAntwortPayloadSchema, FLAdresswechselStoppPayloadSchema } from "@/features/adresswechsel/schemas";
import { runAdresswechselUmzuege } from "@/features/adresswechsel/umzug";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest, readAfterAnsweredWrite } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { AdresswechselAnsicht, AdresswechselGedrueckt } from "@/features/adresswechsel/link";
import type { NextRequest } from "next/server";

/** The page's three presses: the new mailbox's two answers, and the stop of the address on file, one page serving both links. */
const PresseSchema = z.union([
  FLAdresswechselAntwortPayloadSchema,
  FLAdresswechselStoppPayloadSchema.extend({ antwort: z.literal("gestoppt") }),
]);

// A route handler and POST alone, for the consent link's reasons: a
// mail scanner's GET must not answer for the person whether a mailbox is theirs, nor stop a change.
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postAdresswechsel",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      const parsed = PresseSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      const presse = parsed.data;
      // The sign-in store is this server's, so the backend's press cannot refuse an account at the new address: refused
      // here, in the panel its own refusals of the address open. A decline is refused nothing.
      if (presse.antwort === "confirmed" && (await kontoAnNeuerAdresse({ token: presse.token }))) {
        return { success: false as const, zustand: "nicht_bestaetigbar" as const };
      }

      let antwort;
      try {
        if (presse.antwort === "gestoppt") {
          await postAdresswechselStopp({ token: presse.token });
          return gedrueckt("stopped");
        }
        antwort = await postAdresswechselAntwort(presse);
      } catch (error) {
        // The link dying between the open and the press is a panel, never the error page.
        const refusal = mapAdresswechselPresseRefusal(error);
        if (refusal === null) throw error;
        if (!("neuLesen" in refusal)) return { success: false as const, ...refusal };

        // The change ended or this link was answered since the page opened: the link's own read says how, so
        // the page states it rather than calling the link void. Null where that read failed.
        const ansicht: AdresswechselAnsicht | null = await readAfterAnsweredWrite("postAdresswechsel", () =>
          postAdresswechselAnsicht({ token: presse.token }).then(ansichtOf),
        );
        return { success: false as const, ansicht: ansicht };
      }

      // The effect owed its account's carry in its own transaction: behind the response, and by the hourly pass where
      // this one never runs. No address reaches this handler.
      if (antwort.effective) afterTheResponse(runAdresswechselUmzuege);

      return gedrueckt(antwort.antwort, {
        effective: antwort.effective,
        effective_from: antwort.effective_from,
        approval_open: antwort.approval_open,
      });
    },
  });
}

function gedrueckt(
  antwort: AdresswechselGedrueckt["antwort"],
  stand: Pick<AdresswechselGedrueckt, "effective" | "effective_from" | "approval_open"> = {
    effective: false,
    effective_from: null,
    approval_open: false,
  },
): AdresswechselGedrueckt {
  return { success: true, antwort: antwort, ...stand };
}
