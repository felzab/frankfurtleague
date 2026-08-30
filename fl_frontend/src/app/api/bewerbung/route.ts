import { buildBewerbungEingangEmail } from "@/core/bewerbungEmail";
import { postBewerbung } from "@/features/bewerbungen/mutations";
import { collectBewerbungEingangEmpfaenger, sendBewerbungMail } from "@/features/bewerbungen/notifications";
import { FLPostBewerbungPayloadSchema } from "@/features/bewerbungen/schemas";
import { mapBewerbungSubmitRefusal } from "@/features/bewerbungen/utils";
import { VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { buildRefusal } from "@/shared/utils/refusal";
import { toFieldErrors } from "@/shared/utils/validation";

import type { NextRequest } from "next/server";

/** What one submitted application is told back. The record's own id stays off the page. */
const EINGEGANGEN = "Deine Bewerbung ist bei uns eingegangen.";

/**
 * One school's application, submitted by a visitor with no session.
 *
 * A route handler and not a server action: `docs/frontend/spec.md :: I7` starts every action with
 * `getAdminSession()`, and a public export there would read as that rule broken.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postBewerbung",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);
      const parsed = FLPostBewerbungPayloadSchema.safeParse(body);

      if (!parsed.success) {
        return { success: false as const, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(parsed.error) };
      }

      let eingang;
      try {
        eingang = await postBewerbung(parsed.data);
      } catch (error) {
        // The refusal belongs under the field that caused it, not on the error page.
        const refusal = mapBewerbungSubmitRefusal(error);
        if (refusal) return { success: false as const, ...refusal };
        throw error;
      }

      if (!eingang.acknowledged) {
        return {
          success: false as const,
          error: buildRefusal({ reason: "Die Bewerbung wurde nicht gespeichert", repair: "Versuche es erneut" }),
        };
      }

      // No cache to move: no public read holds an application, and both triage reads are uncached
      // (`docs/frontend/spec.md :: I14` leaves the undo handlers the only route-handler invalidators).

      // After the write and never before it: the receipt says the application arrived, and
      // `sendBewerbungMail` settles every address, so nobody's refusal costs the others theirs.
      await sendBewerbungMail({
        operation: "postBewerbung",
        // The Ansprechperson alone, never the fan-out the two decisions use: this receipt is sent
        // before anybody has confirmed an address, and one address is the smaller exposure.
        recipients: collectBewerbungEingangEmpfaenger(parsed.data.kontakte),
        buildMail: (rollenText) => buildBewerbungEingangEmail({ saisonId: eingang.saison_id, rollenText: rollenText }),
      });

      return { success: true as const, message: EINGEGANGEN };
    },
  });
}
