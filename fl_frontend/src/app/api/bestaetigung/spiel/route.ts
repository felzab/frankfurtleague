import { postSpielbestaetigung } from "@/features/spielbestaetigungen/mutations";
import { getSpielbestaetigungAnsicht } from "@/features/spielbestaetigungen/queries";
import { FLSpielbestaetigungAntwortPayloadSchema } from "@/features/spielbestaetigungen/schemas";
import { mapAnsetzungRefusal } from "@/features/spielbestaetigungen/utils";
import { refusedDraftAnswer } from "@/shared/utils/actionError";
import { invalidatesOnWrite } from "@/shared/utils/adminMutation";
import { handlePublicRequest, readAfterAnsweredWrite } from "@/shared/utils/publicRoute";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { SpielbestaetigungAnsicht } from "@/features/spielbestaetigungen/utils";
import type { NextRequest } from "next/server";

const ROUTE_NAME = "postSpielbestaetigung";

/** What the link reads as now, its answer's way and seat or its closing's panel, read after the backend refused the write. */
async function beantworteterStand(token: string): Promise<Exclude<SpielbestaetigungAnsicht, { zustand: "gueltig" | "vorschlag" }>> {
  // Its failure answered here: a doubt reaching the spine would also drop the fixture list for a write that never stood.
  const gelesen = await readAfterAnsweredWrite(ROUTE_NAME, () => getSpielbestaetigungAnsicht(token));

  // An open link is the write's refusal and this read disagreeing, and an unread one says nothing either way: the
  // panel naming nothing is the one answer that claims nothing about a row.
  return gelesen === null || gelesen.zustand === "gueltig" || gelesen.zustand === "vorschlag" ? { zustand: "ungueltig" } : gelesen;
}

// A route handler and not a server action.
/**
 * POST alone, and no GET: a mail scanner fetches every link in a message, and the same-origin guard
 * cannot tell a scanner's GET from a reader's, so a link that wrote on GET would answer for the scanner.
 */
export async function POST(request: NextRequest) {
  return handlePublicRequest(request, {
    routeName: ROUTE_NAME,
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
