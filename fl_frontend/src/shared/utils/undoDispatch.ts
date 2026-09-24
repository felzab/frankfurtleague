import { appToast, UNDO_TIMEOUT_MS } from "./appToast";

import type { ActionFailure } from "@/shared/types/types";

/** `warn` where the committed restore cost something, which is what grades the outcome toast below. */
type UndoOutcome = { success: boolean; message?: string; error?: string; warn?: boolean; outcome?: ActionFailure["outcome"] };

/**
 * Where the route turned the caller away rather than judging the replay, and what the danger toast
 * says before the page is left: `fl_frontend/src/proxy.ts`'s two destinations, whose sign-in lands on
 * `/admin` rather than back on this change.
 */
const TURNED_AWAY = {
  signedOut: { destination: "/signin", description: "Die Änderung steht weiterhin. Melde Dich neu an." },
  // No repair: signing in again is refused to an address the allowlist does not hold.
  withoutAdminRole: { destination: "/", description: "Die Änderung steht weiterhin. Deine Sitzung hat keine Administratorrechte." },
} as const;

type TurnedAway = (typeof TURNED_AWAY)[keyof typeof TURNED_AWAY];

/**
 * An undo nobody can tell landed: a dispatch unanswered, or answered by anything but the route, may
 * have restored the change, and „nicht zurückgenommen“ would send the admin to undo by hand what may
 * already be undone.
 */
const RUECKNAHME_UNKLAR = "Ob die Änderung zurückgenommen wurde, ist unklar. Lade die Seite neu und prüfe sie.";

/** Whether a body parsed at all opens as every outcome of the route's does. */
const isRouteEnvelope = (body: unknown): boolean =>
  typeof body === "object" && body !== null && "success" in body && typeof body.success === "boolean";

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
  /** A stable singleton, so the detached press closure may call its `refresh` and its `replace`. */
  router: { refresh: () => void; replace: (href: string) => void };
};

/**
 * A `fetch`, not a server action: by the time the offer is pressed the editor is unmounted and the
 * browser elsewhere, and an action dispatched from there trips Next's E592 invariant. Revert to a
 * server action once E592 is fixed upstream.
 */
async function postUndo<TPayload>(endpoint: string, body: TPayload): Promise<UndoOutcome | TurnedAway> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Before the transport check: nothing standing in front of the route answers 401.
  if (response.status === 401) {
    return TURNED_AWAY.signedOut;
  }

  // An edge challenge answers 403 as well, in markup: only the route's own carries its envelope.
  if (response.status === 403 && isRouteEnvelope(await response.json().catch(() => null))) {
    return TURNED_AWAY.withoutAdminRole;
  }

  // The route answers 200 with the outcome in the body for every other reportable case, so a non-2xx
  // is a genuine transport failure.
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
          } catch {
            // Unlogged: the browser's one path into the log is the crash report (`docs/logging/spec.md`
            // §1.3), and a bare `console` call writes outside the envelope.
          }
        };

        // The TWO-ARGUMENT `then`: a trailing `.catch` would also catch what the success handler
        // throws, blaming a committed restore on the transport.
        void postUndo(endpoint, body).then(
          (result) => {
            appToast.close(pendingKey);
            if ("destination" in result) {
              // Raised BEFORE leaving, and it outlives the navigation: `AppToaster` is mounted above
              // every route. The destination is the one a save is sent to (`docs/frontend/spec.md :: I251`).
              appToast.danger("Änderung nicht zurückgenommen", { description: result.description });
              router.replace(result.destination);
              return;
            }

            if (!result.success) {
              if (result.outcome === "unknown") appToast.danger("Rücknahme unklar", { description: RUECKNAHME_UNKLAR });
              else appToast.failure("Änderung nicht zurückgenommen", { error: result.error ?? "Die Änderung steht weiterhin." });

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
          () => {
            appToast.close(pendingKey);
            // Unlogged, for the reason the refresh's catch gives: the toast is the whole report.
            appToast.danger("Rücknahme unklar", { description: RUECKNAHME_UNKLAR });
          },
        );
      },
    },
  });
}
