import z from "zod";

import { afterTheResponse } from "@/core/afterResponse";
import { ansichtOf } from "@/features/adresswechsel/link";
import { postAdresswechselAnsicht, postAdresswechselAntwort, postAdresswechselStopp } from "@/features/adresswechsel/mutations";
import { runAdresswechselPostausgang } from "@/features/adresswechsel/postausgang";
import { mapAdresswechselPresseRefusal } from "@/features/adresswechsel/refusals";
import { FLAdresswechselAntwortPayloadSchema, FLAdresswechselStoppPayloadSchema } from "@/features/adresswechsel/schemas";
import { runBerechtigungenAbgleich } from "@/features/berechtigungen/abgleich";
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

// A route handler and POST alone, for the consent link's reasons (`docs/frontend/spec.md` §1.3): a
// mail scanner's GET must not answer for the person whether a mailbox is theirs, nor stop a change.
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postAdresswechsel",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      const parsed = PresseSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      const presse = parsed.data;
      let antwort;
      try {
        if (presse.antwort === "gestoppt") {
          await postAdresswechselStopp({ token: presse.token });
          return gedrueckt("gestoppt");
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

      // The effect queued its notice and its account's carry in its own transaction: delivered behind the response, and
      // by the hourly pass where this drain never runs (`docs/backend/spec.md :: I846`). No address reaches this handler.
      if (antwort.wirksam) {
        afterTheResponse(runAdresswechselPostausgang);
        // A grant the effect moved is announced now, as the approval announces one, not at the next five-minute pass.
        afterTheResponse(runBerechtigungenAbgleich);
      }

      return gedrueckt(antwort.antwort, {
        wirksam: antwort.wirksam,
        wirksam_ab: antwort.wirksam_ab,
        genehmigung_offen: antwort.genehmigung_offen,
      });
    },
  });
}

function gedrueckt(
  antwort: AdresswechselGedrueckt["antwort"],
  stand: Pick<AdresswechselGedrueckt, "wirksam" | "wirksam_ab" | "genehmigung_offen"> = {
    wirksam: false,
    wirksam_ab: null,
    genehmigung_offen: false,
  },
): AdresswechselGedrueckt {
  return { success: true, antwort: antwort, ...stand };
}
