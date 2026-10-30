// Redesign: goes with its last importer.
import { drainSoon } from "@/core/afterResponse";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { turnstileRefusal } from "@/core/turnstile";
import { TURNSTILE_HEADER } from "@/core/turnstileToken";
import { postBewerbung } from "@/features/bewerbungen/mutations";
import { FLPostBewerbungPayloadSchema } from "@/features/bewerbungen/schemas";
import { BEWERBUNG_VERALTET, mapBewerbungSubmitRefusal } from "@/features/bewerbungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest } from "@/shared/utils/publicRoute";

import type { NextRequest } from "next/server";

const ROUTE_NAME = "postBewerbung";

/** The record's own id stays off the page. */
const EINGEGANGEN = "Deine Bewerbung ist bei uns eingegangen.";

/**
 * One school's application, submitted by a visitor with no session.
 *
 * A route handler and not a server action.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: ROUTE_NAME,
    run: async () => {
      // First, before the body is read: nothing an unverified sender posted is parsed, and the write, which
      // mails three addresses the payload names, is never reached past a refusal.
      const refusal = await turnstileRefusal(request.headers.get(TURNSTILE_HEADER));
      if (refusal !== null) return { success: false as const, error: refusal };

      const body: unknown = await request.json().catch(() => null);

      // No label check here, unlike the confirmation handlers: the backend judges the label after
      // its replay lookup, and one here would refuse a retry whose first press is stored (`fassung_unzulaessig`).
      const parsed = FLPostBewerbungPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, BEWERBUNG_VERALTET) };

      try {
        // Passed on as the page sent it, none included: a page loaded before the form sent a key
        // still submits, and the backend judges the key's shape.
        await postBewerbung(parsed.data, request.headers.get(IDEMPOTENCY_KEY_HEADER));
      } catch (error) {
        // The refusal belongs under the field that caused it, not on the error page.
        const refusal = mapBewerbungSubmitRefusal(error);
        if (refusal) return { success: false as const, ...refusal };
        throw error;
      }

      // No cache to move: no public read holds an application, and both triage reads are uncached.

      // The write owed every person's first mail; they leave now rather than at the next pass.
      drainSoon();

      return { success: true as const, message: EINGEGANGEN };
    },
  });
}
