import { frontend_config } from "@/core/config";
import { buildRegistrierungBestaetigungEmail } from "@/core/registrierungEmail";
import { REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/registrierungen/constants";
import { postRegistrierung } from "@/features/registrierungen/mutations";
import { FLPostRegistrierungPayloadSchema } from "@/features/registrierungen/schemas";
import { abgewiesenerVersand, mapRegistrierungSubmitRefusal } from "@/features/registrierungen/utils";
import { sendZielMail } from "@/features/zustellung/notifications";
import { VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { toFieldErrors } from "@/shared/utils/validation";

import type { NextRequest } from "next/server";

// A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
/**
 * POST alone, and no GET: a chat client fetches every link somebody pastes, and the same-origin
 * guard cannot tell a scanner's GET from a reader's, so a link that wrote on GET would register for
 * the scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postRegistrierung",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);
      const parsed = FLPostRegistrierungPayloadSchema.safeParse(body);

      if (!parsed.success) {
        return { success: false as const, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(parsed.error) };
      }

      let eingang;
      try {
        eingang = await postRegistrierung(parsed.data);
      } catch (error) {
        const refusal = mapRegistrierungSubmitRefusal(error);
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
      // production must not mail production links (`docs/frontend/spec.md :: I186`).
      const origin = frontend_config.AUTH_URL;

      // After the write and never before it: outside production this send is withheld after writing
      // the message to the sink, and the row has to survive that so the person can still be reached
      // about it.
      const { delivered, withheld } = await sendZielMail({
        operation: "postRegistrierung",
        // `eingang` is the occasion the application flow already names for a confirmation link sent
        // at a submission.

        // No idempotency key: the body carries a token minted for this one row, so no second send
        // can ever compose it again.
        auftrag: { ziel: "registrierung", zielId: eingang.registrierung_id, anlass: "eingang" },
        recipients: [eingang.email],
        buildMail: () =>
          buildRegistrierungBestaetigungEmail({
            vorname: parsed.data.vorname,
            // Off the write's own answer and never off the body: anyone holding the invite could
            // otherwise decide what the league's message says about the team it names.
            teamName: eingang.team,
            saisonId: eingang.saison_id,
            origin: origin,
            token: eingang.bestaetigung_token,
            fristTage: REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE,
          }),
      });

      // A withheld send is this deployment and not the address, so it answers as a send: the sink
      // holds the message and the link is followed out of it.
      if (delivered.length === 0 && withheld.length === 0) {
        return { success: false as const, ...abgewiesenerVersand() };
      }

      // The bare acknowledgement: which row was written and which link was minted is the mail's, and
      // an echo carrying either would put a live token in the browser's own history.
      return { success: true as const };
    },
  });
}
