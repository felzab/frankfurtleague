import "server-only";

import { frontend_config } from "./config";
import { APINetworkError, MailSendError } from "./errors";
import { logger } from "./logging";
import { getRequestTraceId } from "./requestScope";
import { mintTraceId } from "./trace";

const MAIL_ENDPOINT = "https://api.resend.com/emails";

// One sender for every message the league sends. Splitting per stream isolates sending
// reputation, which two low-volume transactional streams do not need, and costs a second address
// to keep verified with the provider.
const MAIL_FROM = "no-reply@frankfurtleague.de";

// Bounds the WHOLE call the way `fl_frontend/src/core/api.ts :: BASE_FETCH_TIMEOUT_MS` bounds a
// backend call: the sign-in action has a response floor and no ceiling, so a per-attempt budget
// would multiply that floor by the attempts below.
const MAIL_TIMEOUT_MS = 15000;

/** Three, because the provider's own transient set is a rate limit or a blip and neither clears on the instant. */
const MAIL_ATTEMPTS = 3;

/** Long enough for a per-second rate limit to refill, short enough that three attempts stay inside the budget. */
const MAIL_RETRY_DELAY_MS = 400;

export interface OutboundMail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Rides the send and comes back on every delivery event about it, which is what routes one back to
   * the record it belongs to. Each name and value must be ASCII letters, digits, `_` or `-`.
   */
  tags?: Record<string, string>;
  /**
   * Collapses a repeat of the same send inside the provider's 24-hour window, answering the original
   * id rather than sending again. A key reused with a DIFFERENT body is refused rather than ignored.
   */
  idempotencyKey?: string;
}

/**
 * `null` where an accepted answer carried no id: the message went out, and no later delivery event
 * can be joined to it.
 */
export type MailAccepted = { id: string | null };

/** Resolves on the delay, or at once when the whole call's budget has already run out. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const handle = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(handle);
      resolve();
    });
  });
}

/**
 * The one call against the mail provider. **A refusal never carries the provider's message**,
 * which names the recipient -- `fl_frontend/src/core/errors.ts :: MailSendError` takes the
 * stable `name` field instead.
 */
export async function sendMail({ to, subject, html, text, tags, idempotencyKey }: OutboundMail): Promise<MailAccepted> {
  const traceId = getRequestTraceId() ?? mintTraceId();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MAIL_TIMEOUT_MS);

  // Logged where the detail exists: Auth.js hands its own logger the error alone, so a status and
  // the provider's code reach no stream otherwise. The recipient never travels on either line
  // (`docs/logging/spec.md :: L9`).
  const failNetwork = (error: unknown) => {
    const failure = new APINetworkError({
      message: "Mail request failed.",
      isTimeout: error instanceof Error && error.name === "AbortError",
      url: MAIL_ENDPOINT,
      traceId: traceId,
      originalError: error,
    });

    logger.error("mail.send_failed", undefined, {
      error_code: failure.code,
      is_timeout: failure.isTimeout,
      trace_id: traceId,
    });

    return failure;
  };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${frontend_config.AUTH_RESEND_KEY}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey !== undefined) headers["Idempotency-Key"] = idempotencyKey;

  const body = JSON.stringify({
    from: MAIL_FROM,
    to,
    subject,
    html,
    text,
    ...(tags === undefined ? {} : { tags: Object.entries(tags).map(([name, value]) => ({ name: name, value: value })) }),
  });

  const attempt = async (): Promise<MailAccepted> => {
    let res: Response;
    try {
      res = await fetch(MAIL_ENDPOINT, { method: "POST", headers: headers, body: body, signal: controller.signal });
    } catch (error) {
      throw failNetwork(error);
    }

    if (res.ok) {
      let id: string | null = null;
      try {
        const accepted: unknown = await res.json();
        id = accepted && typeof accepted === "object" && "id" in accepted ? String(accepted.id) : null;
      } catch (error) {
        // A stalled body aborts here rather than inside `fetch`. An unreadable one still leaves a
        // message that WENT: reporting the send as failed would take a decision back that stands.
        if (error instanceof Error && error.name === "AbortError") throw failNetwork(error);
      }

      return { id: id };
    }

    let providerErrorName: string | undefined;
    try {
      const refused: unknown = await res.json();
      providerErrorName = refused && typeof refused === "object" && "name" in refused ? String(refused.name) : undefined;
    } catch (error) {
      // A stalled body aborts here rather than inside `fetch`, as it does in
      // `fl_frontend/src/core/api.ts :: apiClient`. An unparseable one is left to the status alone.
      if (error instanceof Error && error.name === "AbortError") throw failNetwork(error);
    }

    throw new MailSendError({
      message: "The mail provider refused the message.",
      url: MAIL_ENDPOINT,
      statusCode: res.status,
      providerErrorName: providerErrorName,
      traceId: traceId,
    });
  };

  /** The line a refusal nobody will retry leaves. `failNetwork` writes its own, so this one is the provider's alone. */
  const logRefusal = (refusal: MailSendError) => {
    logger.error("mail.send_failed", undefined, {
      error_code: refusal.code,
      status_code: refusal.statusCode,
      provider_error_name: refusal.providerErrorName,
      trace_id: traceId,
    });
  };

  try {
    for (let versuch = 1; ; versuch++) {
      try {
        return await attempt();
      } catch (error) {
        // A network failure and a timeout are never retried: the provider may have accepted the
        // request before the connection broke, and a second send without an idempotency key is a
        // second message to a real person.
        if (!(error instanceof MailSendError)) throw error;

        if (!error.isTransient || versuch >= MAIL_ATTEMPTS) {
          logRefusal(error);
          throw error;
        }

        logger.warn("mail.send_retried", {
          error_code: error.code,
          status_code: error.statusCode,
          provider_error_name: error.providerErrorName,
          trace_id: traceId,
        });

        await pause(MAIL_RETRY_DELAY_MS, controller.signal);

        // The budget ran out mid-wait. Attempting anyway would draw a request the aborted signal
        // kills, reporting the provider's own refusal as this application's timeout.
        if (controller.signal.aborted) {
          logRefusal(error);
          throw error;
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
