import "client-only";

import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { TURNSTILE_HEADER } from "@/core/turnstileToken";

import { ZU_VIELE_VERSUCHE } from "./actionError";

import type { FieldErrors } from "./validation";

/**
 * What every public route answers, `fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest`
 * carrying it under a 200 whatever the outcome.
 */
export type PublicEnvelope = {
  success: boolean;
  error?: string;
  fieldErrors?: FieldErrors;
  /** The slice's own sentence for `fieldErrors` no control renders (`fl_frontend/src/shared/utils/actionError.ts :: refusedPayloadAnswer`). */
  unplacedError?: string;
  /**
   * `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`'s marker: the write may have
   * landed, and `error` then carries the administrator's repair, which no visitor can perform.
   */
  outcome?: "unknown";
  /**
   * The refusal saying the first submission under this key stands, with the details it carried: the
   * form titles it as arrived, since a title saying it was not sent would be false.
   */
  schonAngekommen?: true;
};

/** The title every public form gives an answer whose outcome is unknown, whichever form sent it. */
export const UNKLAR_TITEL = "Unklar, ob es bei uns angekommen ist";

/**
 * What each link confirmation tells a visitor whose answer may have landed: reopened, a
 * spent link says so, and a live one takes the answer again.
 */
export const ANTWORT_UNKLAR =
  "Öffne den Link aus Deiner E-Mail noch einmal: Ist Deine Antwort angekommen, steht das dort, sonst antwortest Du dort erneut.";

/**
 * Whether this application answered at all. Nothing standing in front of it produces a field error,
 * so the refused arm carries a sentence and no map for a form to lay over its controls.
 */
export type PublicAnswer<T> =
  | { answered: true; body: T }
  | {
      answered: false;
      /** The one refusal that rules the write out; `EDGE_RATE_LIMIT_STATUS` carries why. */
      wroteNothing: boolean;
      error: string;
    };

/**
 * The edge's rate limit, generated before any route handler runs: the body is nginx's own sentence
 * rather than the envelope, so the status is the whole of what arrived.
 */
export const EDGE_RATE_LIMIT_STATUS = 429;

/** The request reached no judgement, so nothing of what was typed may be named here. */
const KEINE_VERBINDUNG = "Prüfe die Verbindung und versuche es erneut.";

/**
 * Every other answer that was not this application's, an edge challenge among them. It claims
 * nothing about the request: a challenge can answer a POST this application has already written.
 */
const KEINE_ANTWORT_VON_UNS = "Die Website ist gerade nicht erreichbar. Warte einen Moment und versuche es dann erneut.";

/**
 * The client half of `fl_frontend/src/shared/utils/publicRoute.ts :: handlePublicRequest`'s flow, and
 * the one place that knows which answers are not this application's — a form recognising one itself
 * is a form that can miss one (`docs/frontend/spec.md` §1.3).
 */
export async function postPublicForm<T extends PublicEnvelope>(
  endpoint: string,
  payload: unknown,
  { idempotencyKey, turnstileToken }: { idempotencyKey?: string; turnstileToken?: string } = {},
): Promise<PublicAnswer<T>> {
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(idempotencyKey === undefined ? {} : { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey }),
        ...(turnstileToken === undefined ? {} : { [TURNSTILE_HEADER]: turnstileToken }),
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return { answered: false, wroteNothing: false, error: KEINE_VERBINDUNG };
  }

  if (response.status === EDGE_RATE_LIMIT_STATUS) return { answered: false, wroteNothing: true, error: ZU_VIELE_VERSUCHE };

  // The route answers 200 for every case it can report, so any other status was written by something
  // standing in front of it.
  if (!response.ok) return { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // An interstitial served in the application's place carries markup and answers 200 doing it.
    return { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS };
  }

  // `success` is what every route's answer opens on, so a body without one is not an answer of this
  // application's however well it parsed.
  if (typeof body !== "object" || body === null || !("success" in body) || typeof body.success !== "boolean") {
    return { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS };
  }

  return { answered: true, body: body as T };
}
