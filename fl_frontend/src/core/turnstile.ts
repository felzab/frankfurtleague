import "server-only";

import { z } from "zod";

import { turnstileSecretKey } from "./config";
import { logger } from "./logging";
import { boundCall } from "./requestScope";

import type { LogMeta } from "./logging";

/** Called from the server alone: a secret the page held would let anyone pass the check without a browser. */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare's own example's bound, from https://developers.cloudflare.com/turnstile/get-started/server-side-validation/,
// read 2026-10-04: past it the submission goes on unchecked rather than waiting longer.
const SITEVERIFY_TIMEOUT_MS = 10_000;

// The published ceiling on a token, from the same page: a longer one is no token Cloudflare minted.
const TOKEN_MAX_LENGTH = 2048;

/**
 * The codes saying Cloudflare judged no token: its own failure, or a request of ours it refused. Each lets
 * the submission through, so a visitor is never refused for an outage or a wrong secret of ours.
 */
const UNJUDGED = new Set(["internal-error", "missing-input-secret", "invalid-input-secret", "bad-request"]);

/** Every field but these two is ignored: the widget sets no action, and a site key's hostnames are the dashboard's. */
const SiteverifyAnswerSchema = z.object({ success: z.boolean(), "error-codes": z.array(z.string()).default([]) });

/** The one refusal both checked writes answer, whatever Cloudflare judged, so it says nothing about an address. */
export const MENSCH_BESTAETIGEN = "Bitte bestätige kurz, dass Du ein Mensch bist.";

/** Logged once per submission let through unjudged; never the token, which passes the check until spent. */
function unjudged(meta: LogMeta): true {
  logger.error("turnstile.unjudged", undefined, { error_code: "FE-TURNSTILE-001", ...meta });

  return true;
}

/**
 * Whether a submission carrying `token` may go on to send its mail. Cloudflare fronts the whole site, so a
 * check it cannot answer lets the submission through rather than refusing everybody (`docs/frontend/spec.md :: I822`).
 */
export async function passesTurnstile(token: string | null): Promise<boolean> {
  // Refused without asking: Cloudflare would answer either with a judgement against the token.
  if (token === null || token === "" || token.length > TOKEN_MAX_LENGTH) return false;

  // Outside the `try`, which lets an unanswered check through: a fault of this module's own must throw.
  const request = JSON.stringify({ secret: turnstileSecretKey(), response: token });
  const bound = boundCall(SITEVERIFY_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: request,
      signal: bound.signal,
    });
    if (!response.ok) return unjudged({ status: response.status });
    body = await response.json();
  } catch (failed) {
    // The NAME alone: an `AbortError` is the bound, anything else the network or a body that is no JSON.
    return unjudged({ name: failed instanceof Error ? failed.name : "unknown" });
  } finally {
    bound.clear();
  }

  const answer = SiteverifyAnswerSchema.safeParse(body);
  if (!answer.success) return unjudged({ name: "UnreadableAnswer" });
  if (answer.data.success) return true;

  const codes = answer.data["error-codes"];
  // Refused wherever any code judged the token, an empty list included, which explains nothing.
  if (codes.length > 0 && codes.every((code) => UNJUDGED.has(code))) return unjudged({ codes: codes.join(", ") });

  return false;
}
