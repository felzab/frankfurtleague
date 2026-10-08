import "client-only";

import { appToast } from "./appToast";
import { ANTWORT_UNKLAR, UNKLAR_TITEL } from "./publicSubmit";

import type { PublicEnvelope } from "./publicSubmit";

/** A link confirmation's refused answer: one naming the link's own state carries it as `zustand`. */
type RefusedConfirmation<Z> = PublicEnvelope & { success: false; zustand?: Z };

/** Every link confirmation's reading of a refused answer; `onRefusal` raises what is left, the form's own. */
export function reportRefusedConfirmation<Z>(
  antwort: RefusedConfirmation<Z>,
  { onZustand, onRefusal }: { onZustand: (zustand: Z) => void; onRefusal: () => void },
): void {
  // Titled as an unread answer is, the answer having perhaps landed: the envelope's own sentence is
  // an administrator's repair, and a reload of the page has lost its token.
  if (antwort.outcome === "unknown") {
    appToast.danger(UNKLAR_TITEL, { description: ANTWORT_UNKLAR });
    return;
  }

  // The link died between the open and the press: the answer is the panel, never a toast.
  if (antwort.zustand !== undefined) {
    onZustand(antwort.zustand);
    return;
  }

  onRefusal();
}
