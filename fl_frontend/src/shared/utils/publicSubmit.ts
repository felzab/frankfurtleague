import type { FieldErrors } from "./validation";

/**
 * What every public route answers, `fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest`
 * carrying it under a 200 whatever the outcome.
 */
export type PublicEnvelope = { success: boolean; error?: string; fieldErrors?: FieldErrors };

/**
 * Whether this application answered at all. Nothing standing in front of it produces a field error,
 * so the refused arm carries a sentence and no map for a form to lay over its controls.
 */
export type PublicAnswer<T> = { answered: true; body: T } | { answered: false; error: string };

/**
 * The edge's rate limit, generated before any route handler runs: the body is nginx's own HTML
 * rather than the envelope, so the status is the whole of what arrived.
 */
export const EDGE_RATE_LIMIT_STATUS = 429;

/** The one cause the visitor can act on, which is why it keeps a sentence of its own. */
const ZU_VIELE_VERSUCHE = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann noch einmal.";

/** The request reached no judgement, so nothing of what was typed may be named here. */
const KEINE_VERBINDUNG = "Prüfe Deine Verbindung und versuche es erneut.";

/**
 * Every other answer that was not this application's, an edge challenge among them. It names no
 * cause, none being anything the visitor can act on, and it must not read as a submission received.
 */
const NICHT_ANGEKOMMEN = "Deine Anfrage ist gerade nicht angekommen. Warte einen Moment und versuche es dann noch einmal.";

/**
 * The client half of `fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest`'s flow, and
 * the one place that knows which answers are not this application's — a form recognising one itself
 * is a form that can miss one (`docs/frontend/spec.md` §1.3).
 */
export async function postPublicForm<T extends PublicEnvelope>(endpoint: string, payload: unknown): Promise<PublicAnswer<T>> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { answered: false, error: KEINE_VERBINDUNG };
  }

  if (response.status === EDGE_RATE_LIMIT_STATUS) return { answered: false, error: ZU_VIELE_VERSUCHE };

  // The route answers 200 for every case it can report, so any other status was written by something
  // the request never got past.
  if (!response.ok) return { answered: false, error: NICHT_ANGEKOMMEN };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // An interstitial served in the application's place carries markup and answers 200 doing it.
    return { answered: false, error: NICHT_ANGEKOMMEN };
  }

  // `success` is what every route's answer opens on, so a body without one is not an answer of this
  // application's however well it parsed.
  if (typeof body !== "object" || body === null || !("success" in body) || typeof body.success !== "boolean") {
    return { answered: false, error: NICHT_ANGEKOMMEN };
  }

  return { answered: true, body: body as T };
}
