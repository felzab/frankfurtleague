import "server-only";

import { frontend_config } from "./config";
import { mintCorrelationId } from "./correlation";
import { APINetworkError, MailSendError } from "./errors";
import { logger } from "./logging";
import { getRequestCorrelationId } from "./requestScope";

const MAIL_ENDPOINT = "https://api.resend.com/emails";

// One sender for every message the league sends. Splitting per stream isolates sending
// reputation, which two low-volume transactional streams do not need, and costs a second address
// to keep verified with the provider.
const MAIL_FROM = "no-reply@frankfurtleague.de";

// Bounds the send the way `fl_frontend/src/core/api.ts :: BASE_FETCH_TIMEOUT_MS` bounds a backend
// call: the sign-in action has a response floor and no ceiling, so an unbounded send hangs it.
const MAIL_TIMEOUT_MS = 15000;

export interface OutboundMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * The one call against the mail provider. **A refusal never carries the provider's message**,
 * which names the recipient -- `fl_frontend/src/core/errors.ts :: MailSendError` takes the
 * stable `name` field instead.
 */
export async function sendMail({ to, subject, html, text }: OutboundMail): Promise<void> {
  const correlationId = getRequestCorrelationId() ?? mintCorrelationId();

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
      correlationId: correlationId,
      originalError: error,
    });

    logger.error("mail.send_failed", undefined, {
      error_code: failure.code,
      is_timeout: failure.isTimeout,
      correlation_id: correlationId,
    });

    return failure;
  };

  try {
    let res: Response;
    try {
      res = await fetch(MAIL_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${frontend_config.AUTH_RESEND_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: MAIL_FROM, to, subject, html, text }),
        signal: controller.signal,
      });
    } catch (error) {
      throw failNetwork(error);
    }

    if (res.ok) {
      // The connection is held until the body settles, and the provider's id is read by nothing.
      await res.body?.cancel().catch(() => undefined);
      return;
    }

    let providerErrorName: string | undefined;
    try {
      const body: unknown = await res.json();
      providerErrorName = body && typeof body === "object" && "name" in body ? String(body.name) : undefined;
    } catch (error) {
      // A stalled body aborts here rather than inside `fetch`, as it does in
      // `fl_frontend/src/core/api.ts :: apiClient`. An unparseable one is left to the status alone.
      if (error instanceof Error && error.name === "AbortError") throw failNetwork(error);
    }

    const failure = new MailSendError({
      message: "The mail provider refused the message.",
      url: MAIL_ENDPOINT,
      statusCode: res.status,
      providerErrorName: providerErrorName,
      correlationId: correlationId,
    });

    logger.error("mail.send_failed", undefined, {
      error_code: failure.code,
      status_code: failure.statusCode,
      provider_error_name: failure.providerErrorName,
      correlation_id: correlationId,
    });

    throw failure;
  } finally {
    clearTimeout(timeoutId);
  }
}
