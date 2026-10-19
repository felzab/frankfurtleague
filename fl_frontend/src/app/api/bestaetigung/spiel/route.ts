import { nullUnlessContractBreak } from "@/core/errors";
import { runAnsweringOwnCut } from "@/core/requestScope";
import { postSpielbestaetigung } from "@/features/spielbestaetigungen/mutations";
import { getSpielbestaetigungAnsicht } from "@/features/spielbestaetigungen/queries";
import { FLSpielbestaetigungAntwortPayloadSchema } from "@/features/spielbestaetigungen/schemas";
import { mapAnsetzungRefusal } from "@/features/spielbestaetigungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { invalidatesOnWrite } from "@/shared/utils/adminMutation";
import { handlePublicRequest } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { SpielbestaetigungAnsicht } from "@/features/spielbestaetigungen/utils";
import type { NextRequest } from "next/server";

/** What the link reads as now, its answer's way and seat or its closing's panel, read after the backend refused the write. */
async function beantworteterStand(token: string): Promise<Exclude<SpielbestaetigungAnsicht, { zustand: "gueltig" | "vorschlag" }>> {
  // Its own cut, and its failure answered here: the write was refused, so no doubt about it may reach the spine,
  // which would call the outcome unknown and drop the fixture list for a write that never stood.
  const gelesen = await runAnsweringOwnCut(() => getSpielbestaetigungAnsicht(token)).catch(nullUnlessContractBreak);

  // An open link is the write's refusal and this read disagreeing, and an unread one says nothing either way: the
  // panel naming nothing is the one answer that claims nothing about a row.
  return gelesen === null || gelesen.zustand === "gueltig" || gelesen.zustand === "vorschlag" ? { zustand: "ungueltig" } : gelesen;
}

// A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
/**
 * POST alone, and no GET: a mail scanner fetches every link in a message, and the same-origin guard
 * cannot tell a scanner's GET from a reader's, so a link that wrote on GET would answer for the scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: "postSpielbestaetigung",
    run: async () => {
      // Ahead of the first await: an answer moves the confirmation verdict the cached fixture list serves,
      // so the list is dropped wherever the answer may stand, and nowhere a write was not sent.
      invalidatesOnWrite("spiele");
      const body: unknown = await request.json().catch(() => null);

      const parsed = FLSpielbestaetigungAntwortPayloadSchema.safeParse(body);

      if (!parsed.success) return { success: false as const, ...refusedDraftAnswer(parsed.error, ANTWORT_NEU_OEFFNEN) };

      let antwort;
      try {
        antwort = await postSpielbestaetigung(parsed.data);
      } catch (error) {
        // The refusal belongs on a box or on the dead-link panel, not on the error page.
        const refusal = mapAnsetzungRefusal(error);
        if (refusal === null) throw error;

        // Destructured rather than spread whole: `nachlesen` is this handler's instruction, and the page
        // has no arm for it.
        const { nachlesen, ...panel } = refusal;

        if (nachlesen === true) return { success: false as const, ...(await beantworteterStand(parsed.data.token)) };

        return { success: false as const, ...panel };
      }

      // The echo alone, never the seat that pressed: the reader is shown what was stored and nothing else the write knows.
      return { success: true as const, zustand: antwort.zustand, vorschlag: antwort.vorschlag };
    },
  });
}
