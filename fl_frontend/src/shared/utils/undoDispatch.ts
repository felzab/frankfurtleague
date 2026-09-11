import { appToast, UNDO_TIMEOUT_MS } from "./appToast";

/** `warn` where the committed restore cost something, which is what grades the outcome toast below. */
type UndoOutcome = { success: boolean; message?: string; error?: string; warn?: boolean };

type UndoOffer<TPayload> = {
  /** The slice's own route on `fl_frontend/src/shared/utils/undoRoute.ts :: handleUndoRequest`, whose schema parses `body`. */
  endpoint: `/api/admin/${string}/undo`;
  /** The pre-save values the press replays, built from the render's props before the save moved them. */
  body: TPayload;
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
  /** A stable singleton, so the detached press closure may call its `refresh`. */
  router: { refresh: () => void };
  /** Replaces the transport-failure toast — `AdminEditSpielDataForm` reports the raw error. */
  reportRejection?: (dispatchError: unknown) => void;
};

/**
 * A `fetch`, not a server action: by the time the offer is pressed the editor is unmounted and the
 * browser elsewhere, and an action dispatched from there trips Next's E592 invariant. Revert to a
 * server action once E592 is fixed upstream.
 */
async function postUndo<TPayload>(endpoint: string, body: TPayload): Promise<UndoOutcome> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // The route answers 200 with the outcome in the body for every reportable case, so a non-2xx is a
  // genuine transport failure.
  if (!response.ok) {
    throw new Error(`HTTP ${String(response.status)}`);
  }

  return response.json() as Promise<UndoOutcome>;
}

/**
 * The client half of `fl_frontend/src/shared/utils/undoRoute.ts :: handleUndoRequest`'s flow: the
 * offer toast, then on press the pending toast, the dispatch and its outcomes. The toast outlives
 * the editor, so the press runs detached.
 */
export function offerUndo<TPayload>({
  endpoint,
  body,
  message,
  fallback,
  warn = false,
  unrestorable = null,
  router,
  reportRejection,
}: UndoOffer<TPayload>): void {
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

        // Closed by its own key: a toast with no explicit timeout inherits a default that would
        // retire it mid-flight.
        const pendingKey = appToast.pending("Nimmt Änderung zurück...");

        // Best-effort: a refresh that cannot run costs a stale screen, never the restore.
        const refreshTheScreen = () => {
          try {
            router.refresh();
          } catch (refreshError) {
            console.warn("Undo answered, refresh failed", refreshError);
          }
        };

        // The TWO-ARGUMENT `then`: a trailing `.catch` would also catch what the success handler
        // throws, blaming a committed restore on the transport.
        void postUndo(endpoint, body).then(
          (result) => {
            appToast.close(pendingKey);
            if (!result.success) {
              appToast.danger("Änderung nicht zurückgenommen", { description: result.error ?? "Die Änderung steht weiterhin." });

              // Re-read on a refusal too: a restore that stopped part-way put rows back, and `success`
              // says the undo did not finish rather than that nothing moved.
              refreshTheScreen();
              return;
            }

            // Reported BEFORE the refresh: the restore is committed and nothing below changes that.
            // The title moves with the grade, for the reason the offer's does.
            const withCost = result.warn === true;
            const raiseOutcome = withCost ? appToast.warning : appToast.success;
            raiseOutcome(withCost ? "Mit Folgen zurückgenommen" : "Änderung zurückgenommen", { description: result.message });

            refreshTheScreen();
          },
          (dispatchError) => {
            appToast.close(pendingKey);
            console.warn("Undo dispatch failed", dispatchError);
            if (reportRejection !== undefined) {
              reportRejection(dispatchError);
              return;
            }

            appToast.danger("Änderung nicht zurückgenommen", {
              // The connection alone: the request reached no judgement, so naming what was saved
              // would send the admin to inspect values nothing here read.
              description: "Die Änderung steht weiterhin. Prüfe die Verbindung.",
            });
          },
        );
      },
    },
  });
}
