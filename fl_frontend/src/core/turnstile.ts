import "server-only";

import { z } from "zod";

import { turnstileSecretKey } from "./config";
import { logger } from "./logging";
import { boundCall } from "./requestScope";
import { MENSCH_BESTAETIGEN } from "./turnstileToken";

import type { LogMeta } from "./logging";

/** Called from the server alone: a secret the page held would let anyone pass the check without a browser. */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare's own example's bound, from https://developers.cloudflare.com/turnstile/get-started/server-side-validation/,
// read 2026-10-04, over both attempts: past it the submission goes on unchecked rather than waiting longer.
const SITEVERIFY_TIMEOUT_MS = 10_000;

// The published ceiling on a token, from the same page: a longer one is no token Cloudflare minted.
const TOKEN_MAX_LENGTH = 2048;

/**
 * Cloudflare refusing our own secret or request shape, which no visitor can repair. Refused, so a wrong
 * key shows at the first submission instead of switching the check off unseen (`docs/frontend/spec.md :: I822`).
 */
const OURS = new Set(["missing-input-secret", "invalid-input-secret", "bad-request"]);

/** Cloudflare's own failure, which its page answers with "Retry the request", once. */
const THEIRS = "internal-error";

/** Every field but these two is ignored: the widget sets no action, and a site key's hostnames are the dashboard's. */
const SiteverifyAnswerSchema = z.object({ success: z.boolean(), "error-codes": z.array(z.string()).default([]) });

/** The refusal a check of ours Cloudflare would not take answers: nothing the visitor does repairs it. */
export const PRUEFUNG_GESTOERT = "Die Prüfung, ob Du ein Mensch bist, ist gerade gestört. Versuche es später erneut.";

/**
 * One answer of Cloudflare's: its error codes, an empty list where it passed the token; the status of a request
 * it refused unread; or `null` where none arrived.
 */
type Answer = { readonly passed: boolean; readonly codes: readonly string[] } | { readonly refusedStatus: number } | null;

/** Too many requests is Cloudflare declining to answer, not judging ours. */
const TOO_MANY_REQUESTS = 429;

/** Logged once per submission let through unjudged; never the token, which passes the check until spent. */
function unjudged(meta: LogMeta): null {
  logger.error("turnstile.unjudged", undefined, { error_code: "FE-TURNSTILE-001", ...meta });

  return null;
}

/** Asks Cloudflare once; `null`, with its one log line, where no readable answer arrived. */
async function ask(request: string, signal: AbortSignal): Promise<Answer> {
  let body: unknown;
  try {
    const response = await fetch(SITEVERIFY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: request, signal });
    // A 4xx is Cloudflare answering that our request is wrong, which every later one repeats; a 5xx is it failing.
    if (response.status >= 400 && response.status < 500 && response.status !== TOO_MANY_REQUESTS) return { refusedStatus: response.status };
    if (!response.ok) return unjudged({ status: response.status });
    body = await response.json();
  } catch (failed) {
    // The NAME alone: an `AbortError` is the bound, anything else the network or a body that is no JSON.
    return unjudged({ name: failed instanceof Error ? failed.name : "unknown" });
  }

  const answer = SiteverifyAnswerSchema.safeParse(body);
  if (!answer.success) return unjudged({ name: "UnreadableAnswer" });

  return { passed: answer.data.success, codes: answer.data["error-codes"] };
}

/**
 * The sentence a submission carrying `token` is refused with, or `null` where it may go on to send its mail.
 * Only an unreachable Cloudflare lets a submission through unjudged: it fronts the whole site anyway.
 */
export async function turnstileRefusal(token: string | null): Promise<string | null> {
  // Refused without asking: Cloudflare would answer either with a judgement against the token.
  if (token === null || token === "" || token.length > TOKEN_MAX_LENGTH) return MENSCH_BESTAETIGEN;

  // Outside every `try`, which lets an unanswered check through: a fault of this module's own must throw.
  // One key over both attempts, so Cloudflare answers a retry of one judgement rather than spending the token twice.
  const request = JSON.stringify({ secret: turnstileSecretKey(), response: token, idempotency_key: crypto.randomUUID() });
  const bound = boundCall(SITEVERIFY_TIMEOUT_MS);
  try {
    let answer = await ask(request, bound.signal);
    const theirsAlone = (judged: Answer): boolean =>
      judged !== null && "codes" in judged && !judged.passed && judged.codes.length > 0 && judged.codes.every((code) => code === THEIRS);
    if (theirsAlone(answer)) answer = await ask(request, bound.signal);

    if (answer === null) return null;
    if ("refusedStatus" in answer) {
      logger.error("turnstile.request_refused", undefined, { error_code: "FE-TURNSTILE-002", status: answer.refusedStatus });
      return PRUEFUNG_GESTOERT;
    }
    if (answer.passed) return null;
    if (answer.codes.some((code) => OURS.has(code))) {
      logger.error("turnstile.request_refused", undefined, { error_code: "FE-TURNSTILE-002", codes: answer.codes.join(", ") });
      return PRUEFUNG_GESTOERT;
    }
    if (theirsAlone(answer)) return unjudged({ codes: answer.codes.join(", ") });

    // Every other answer judged the token, an empty list included, which explains nothing.
    return MENSCH_BESTAETIGEN;
  } finally {
    bound.clear();
  }
}
