// Redesign: goes with its last importer.
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { turnstileRefusal } from "@/core/turnstile";
import { TURNSTILE_HEADER } from "@/core/turnstileToken";
import { postBewerbung } from "@/features/bewerbungen/mutations";
import { FLPostBewerbungPayloadSchema } from "@/features/bewerbungen/schemas";
import { BEWERBUNG_VERALTET, mapBewerbungSubmitRefusal } from "@/features/bewerbungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { handlePublicRequest } from "@/shared/utils/publicRoute";

import type { FLPostBewerbungPayload } from "@/core/generated/client/types";
import type { NextRequest } from "next/server";
import type { z } from "zod";

const ROUTE_NAME = "postBewerbung";

/** The record's own id stays off the page. */
const EINGEGANGEN = "Deine Bewerbung ist bei uns eingegangen.";

/** The switch's answer stays on this page: the backend takes no acknowledgement. */
function ohneKenntnisnahme(data: z.infer<typeof FLPostBewerbungPayloadSchema>): FLPostBewerbungPayload {
  const ohne = ({ einwilligung: _, ...person }: typeof data.kontakte.trainer) => person;
  const { trainer, ansprechperson, stellvertretung, trainer_is_also } = data.kontakte;

  return {
    ...data,
    kontakte: { trainer: ohne(trainer), ansprechperson: ohne(ansprechperson), stellvertretung: ohne(stellvertretung), trainer_is_also },
  };
}

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

      const parsed = FLPostBewerbungPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, BEWERBUNG_VERALTET) };

      try {
        // Passed on as the page sent it, none included: a page loaded before the form sent a key
        // still submits, and the backend judges the key's shape.
        await postBewerbung(ohneKenntnisnahme(parsed.data), request.headers.get(IDEMPOTENCY_KEY_HEADER));
      } catch (error) {
        // The refusal belongs under the field that caused it, not on the error page.
        const refusal = mapBewerbungSubmitRefusal(error);
        if (refusal) return { success: false as const, ...refusal };
        throw error;
      }

      // No cache to move: no public read holds an application, and both triage reads are uncached.

      return { success: true as const, message: EINGEGANGEN };
    },
  });
}
