import { revalidateTag } from "next/cache";

import { SCHIEDSRICHTER_EINWILLIGUNG } from "@/core/einwilligung";
import { stampEinwilligungFassung } from "@/features/bewerbungen/utils";
import { postSchiedsrichterBestaetigung } from "@/features/schiedsrichter/mutations";
import { getSchiedsrichterBestaetigungAnsicht, mapSchiedsrichterBestaetigungRefusal } from "@/features/schiedsrichter/queries";
import { FLSchiedsrichterBestaetigungPayloadSchema } from "@/features/schiedsrichter/schemas";
import { VALIDATION_FAILED } from "@/shared/utils/adminMutation";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { toFieldErrors } from "@/shared/utils/validation";

import type { NextRequest } from "next/server";

// Never resolved in front of the mapper: this read answers no floor for the three states that ARE
// the answer, so a caller asking first gives up on them.
/**
 * The floor this link's own read answered, for the one refusal that names a number. A failed read
 * leaves that refusal unworded rather than guessing a floor.
 */
async function mindestalterFuerToken(token: string): Promise<number | null> {
  return getSchiedsrichterBestaetigungAnsicht(token).then(
    (gelesen) => (gelesen.zustand === "gueltig" ? gelesen.ansicht.mindestalter : null),
    () => null,
  );
}

// A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
/**
 * POST alone, and no GET: a mail scanner fetches every link in a message, and the same-origin guard
 * cannot tell a scanner's GET from a reader's, so a link that wrote on GET would confirm for the
 * scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postSchiedsrichterBestaetigung",
    run: async () => {
      const body: unknown = await request.json().catch(() => null);

      // Stamped BEFORE the parse, through the helper all three confirmation handlers share: the
      // label is this server's to write, so judging the browser's own would refuse a body on
      // `text_version`, which no control renders and no reader would see.
      const gestempelt =
        typeof body === "object" && body !== null ? stampEinwilligungFassung(body, SCHIEDSRICHTER_EINWILLIGUNG.textVersion) : body;
      const parsed = FLSchiedsrichterBestaetigungPayloadSchema.safeParse(gestempelt);

      if (!parsed.success) {
        return { success: false as const, error: VALIDATION_FAILED, fieldErrors: toFieldErrors(parsed.error) };
      }

      let antwort;
      try {
        antwort = await postSchiedsrichterBestaetigung(parsed.data);
      } catch (error) {
        // The refusal belongs on the field or on the dead-link panel, not on the error page.
        const refusal = await mapSchiedsrichterBestaetigungRefusal(error, () => mindestalterFuerToken(parsed.data.token));
        if (refusal === null) throw error;

        return { success: false as const, ...refusal };
      }

      // `revalidateTag` and never `updateTag`, which throws here (`docs/frontend/spec.md :: I14`);
      // `{ expire: 0 }` because the recommended profile otherwise serves the withheld name once more.
      revalidateTag("spiele", { expire: 0 });

      // The echo alone: this person is shown what was stored for them and nothing else the write knows.
      return { success: true as const, umfang: antwort.umfang, medien: antwort.medien, bestaetigt_am: antwort.bestaetigt_am };
    },
  });
}
