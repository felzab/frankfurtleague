import { unstable_isUnrecognizedActionError, unstable_rethrow } from "next/navigation";

import { STEP_UP_REFUSED } from "@/shared/components/ui/stepUp";

import { AENDERUNG_STEHT_WEITERHIN, edgeRefusedSend, rejectedWrite, RUECKNAHME_UNKLAR } from "./actionError";
import { appToast, UNDO_TIMEOUT_MS } from "./appToast";

import type { StepUp } from "@/shared/components/ui/stepUp";
import type { ActionFailure } from "@/shared/types/types";
import type { UndoOutcome } from "./adminUndo";

/** The edge refused the press before Next ran it, so nothing was taken back, and the offer it came from is gone. */
const ZU_VIELE_RUECKNAHMEN = `Zu viele Versuche in kurzer Zeit. ${AENDERUNG_STEHT_WEITERHIN}`;

/** A deploy since the page loaded retired the action the offer names, so nothing ran; a reload loads the running build. */
const SEITE_VERALTET = `Die Website wurde inzwischen aktualisiert. Lade die Seite neu. ${AENDERUNG_STEHT_WEITERHIN}`;

type UndoOffer = {
  /**
   * The slice's undo action, called with the pre-save values it replays, which the caller builds from
   * the render's props before the save moved them.
   */
  undo: () => Promise<UndoOutcome>;
  /** The save's own sentence, where it produced one. */
  message?: string;
  /**
   * Required, never optional: the register identifies `Änderung gespeichert` by its description
   * (`docs/frontend/spec.md :: I42`), so a site sparing the Rückgängig control a row would raise
   * the shared title with nothing telling it apart.
   */
  fallback: string;
  /** A warning rather than a success: the save cost something the admin may not have intended. */
  warn?: boolean;
  /** A refusal judged before the press, where the caller already knows the replay is no legal write. */
  unrestorable?: string | null;
  /**
   * The page's step-up, where the replay is a step-up write: the offer outlives the page's tree, so
   * the press asks through the provider it was offered under.
   */
  stepUp?: StepUp;
  /** A stable singleton, so the detached press closure may call its `refresh`. */
  router: { refresh: () => void };
};

/**
 * The undo offer every page-owned editor raises: the offer toast, then on press the pending toast, the
 * slice's undo action and its outcomes. The toast outlives the editor, so the press runs detached.
 */
export function offerUndo({ undo, message, fallback, warn = false, unrestorable = null, stepUp, router }: UndoOffer): void {
  const raise = warn ? appToast.warning : appToast.success;

  // The title moves with the grade: one outcome per title, or the colour carries a meaning the same
  // words deny (`docs/frontend/spec.md :: I42`).
  raise(warn ? "Mit Folgen gespeichert" : "Änderung gespeichert", {
    description: message ?? fallback,
    timeout: UNDO_TIMEOUT_MS,
    actionProps: {
      children: "Rückgängig",
      onPress: () => {
        appToast.clear();
        if (unrestorable !== null) {
          // One title for every way the change stands: the outcome is the same one, and the
          // description separates a refusal from a dispatch that never landed
          // (`docs/frontend/spec.md :: I42`).
          appToast.danger("Änderung nicht zurückgenommen", { description: unrestorable });
          return;
        }

        // Asked in the press itself, whose user activation the prompt needs; nothing is sent where
        // it is refused (`docs/frontend/spec.md :: I431`).
        if (stepUp?.isStale(Date.now()) === true) {
          void stepUp.confirm().then((confirmed) => {
            if (confirmed) dispatch();
            else appToast.danger("Änderung nicht zurückgenommen", { description: STEP_UP_REFUSED });
          });
          return;
        }

        dispatch();
      },
    },
  });

  /**
   * The action's rejection: the edge's refusal and an action the running build does not hold took
   * nothing back, and anything else may follow a landed restore.
   */
  function rejected(error: unknown): Pick<ActionFailure, "error" | "outcome"> {
    if (edgeRefusedSend(error) !== null) return { error: ZU_VIELE_RUECKNAHMEN };
    if (unstable_isUnrecognizedActionError(error)) return { error: SEITE_VERALTET };

    return rejectedWrite(router, RUECKNAHME_UNKLAR)(error);
  }

  function dispatch(): void {
    // Closed by its own key: a toast with no explicit timeout inherits a default that would
    // retire it mid-flight.
    const pendingKey = appToast.pending("Nimmt Änderung zurück...");

    // The TWO-ARGUMENT `then`: a trailing `.catch` would also catch what the success handler
    // throws, blaming a committed restore on the transport. The action re-reads the page itself
    // wherever its replay wrote, so neither arm answering refreshes it.
    void undo().then(
      (result) => {
        appToast.close(pendingKey);
        if (!result.success) {
          // The action's own sentence under its outcome's title: it names what to check.
          appToast.failure("Änderung nicht zurückgenommen", result, "Rücknahme unklar", "Nur teilweise zurückgenommen");
          return;
        }

        // The title moves with the grade, for the reason the offer's does.
        const raiseOutcome = result.warn ? appToast.warning : appToast.success;
        raiseOutcome(result.warn ? "Mit Folgen zurückgenommen" : "Änderung zurückgenommen", { description: result.message });
      },
      (error: unknown) => {
        appToast.close(pendingKey);
        // Next's own redirect, the proxy turning a lapsed session away: the page leaves for `/signin`
        // as a save's does, and a toast raised here would call unclear an undo that never ran.
        unstable_rethrow(error);
        appToast.failure("Änderung nicht zurückgenommen", rejected(error), "Rücknahme unklar");
      },
    );
  }
}
