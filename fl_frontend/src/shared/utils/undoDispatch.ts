import { appToast, UNDO_TIMEOUT_MS } from "./appToast";

type UndoOutcome = { success: boolean; message?: string; error?: string };

type UndoOffer<TPayload> = {
  /** The slice's own route on `fl_frontend/src/shared/utils/undoRoute.ts :: handleUndoRequest`, whose schema parses `body`. */
  endpoint: `/api/admin/${string}/undo`;
  /** The pre-save values the press replays, built from the render's props before the save moved them. */
  body: TPayload;
  /** The save's own sentence, where it produced one. */
  message?: string;
  /**
   * Every offer carries one: the saved toast shares its title, so a site describing nothing cannot
   * be told from the others (`docs/frontend/spec.md :: I42`).
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
          appToast.danger("Rücknahme nicht möglich", { description: unrestorable });
          return;
        }

        // Closed by its own key: a toast with no explicit timeout inherits a default that would
        // retire it mid-flight.
        const pendingKey = appToast.pending("Änderung wird zurückgenommen...");

        // The TWO-ARGUMENT `then`: a trailing `.catch` would also catch what the success handler
        // throws, blaming a committed restore on the transport.
        void postUndo(endpoint, body).then(
          (result) => {
            appToast.close(pendingKey);
            if (!result.success) {
              appToast.danger("Rücknahme fehlgeschlagen", { description: result.error ?? "Die Änderung steht weiterhin." });
              return;
            }

            // Reported BEFORE the refresh: the restore is committed and nothing below changes that.
            appToast.success("Änderung zurückgenommen", { description: result.message });

            // Best-effort: a refresh that cannot run costs a stale screen, never the restore.
            try {
              router.refresh();
            } catch (refreshError) {
              console.warn("Undo committed, refresh failed", refreshError);
            }
          },
          (dispatchError) => {
            appToast.close(pendingKey);
            console.warn("Undo dispatch failed", dispatchError);
            if (reportRejection !== undefined) {
              reportRejection(dispatchError);
              return;
            }

            appToast.danger("Rücknahme konnte nicht gesendet werden", {
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
