// Redesign: goes with its last importer.
import { drainSoon } from "@/core/afterResponse";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { turnstileRefusal } from "@/core/turnstile";
import { TURNSTILE_HEADER } from "@/core/turnstileToken";
import { postRegistrierung } from "@/features/registrierungen/mutations";
import { FLPostRegistrierungPayloadSchema } from "@/features/registrierungen/schemas";
import { mapRegistrierungSubmitRefusal } from "@/features/registrierungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { REGISTRIERUNG_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { NextRequest } from "next/server";

// A route handler and not a server action.
/**
 * POST alone, and no GET: a chat client fetches every link somebody pastes, and the same-origin
 * guard cannot tell a scanner's GET from a reader's, so a link that wrote on GET would register for
 * the scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postRegistrierung",
    run: async () => {
      // First, before the body is read: nothing an unverified sender posted is parsed, and the write, which
      // mails the address the visitor typed, is never reached past a refusal.
      const refusal = await turnstileRefusal(request.headers.get(TURNSTILE_HEADER));
      if (refusal !== null) return { success: false as const, error: refusal };

      const body: unknown = await request.json().catch(() => null);
      const parsed = FLPostRegistrierungPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, REGISTRIERUNG_NEU_OEFFNEN) };

      try {
        // Passed on as the page sent it, none included: a page loaded before the form sent a key
        // still submits, and the backend judges the key's shape.
        await postRegistrierung(parsed.data, request.headers.get(IDEMPOTENCY_KEY_HEADER));
      } catch (error) {
        const refusal = mapRegistrierungSubmitRefusal(error);
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // The write owed the confirmation mail; it leaves now rather than at the next pass.
      drainSoon();

      // The bare acknowledgement: which row was written is the mail's to say.
      return { success: true as const };
    },
  });
}
