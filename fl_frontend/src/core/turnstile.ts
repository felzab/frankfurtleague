import "server-only";

import { z } from "zod";

import { turnstileSecretKey } from "./config";
import { COPY } from "./copy/shared";
import { logger } from "./logging";
import { boundCall } from "./requestScope";
import { BOT_CHECK_WAIT_MS, CONFIRM_HUMAN } from "./turnstileToken";

import type { Copy } from "./copy";
import type { LogMeta } from "./logging";

/** Called from the server alone: a secret the page held would let anyone pass the check without a browser. */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// The published ceiling on a token, from https://developers.cloudflare.com/turnstile/get-started/server-side-validation/:
// a longer one is no token Cloudflare minted.
const TOKEN_MAX_LENGTH = 2048;

/** Cloudflare's own failure, which its page answers with "Retry the request", once. */
const THEIRS = "internal-error";

/**
 * The codes naming our secret or our request rather than the token, which its page answers with checking the secret or
 * the request. The page documents these codes and no status for them, so they judge no token whatever status carries
 * them.
 */
const OURS: ReadonlySet<string> = new Set(["missing-input-secret", "invalid-input-secret", "bad-request"]);

/** Every field but these two is ignored: the widget sets no action, and a site key's hostnames are the dashboard's. */
const SiteverifyAnswerSchema = z.object({ success: z.boolean(), "error-codes": z.array(z.string()).default([]) });

/** The refusal a check that did not run answers: nothing the visitor does repairs it, so it says no reason. */
export const CHECK_DISRUPTED = COPY.shared.failure.unexpected;

/**
 * One answer of Cloudflare's: its judgement of the token, or, where it gave none, what the one log line names, with
 * `theirs` where that was Cloudflare's own failure, which its page says to retry.
 */
type Answer = { readonly passed: boolean } | { readonly unanswered: LogMeta; readonly theirs: boolean };

/**
 * Asks Cloudflare once. What is no judgement keeps the status and any codes Cloudflare named, so a wrong, expired or
 * rotated secret reads in the log as itself; never the token, which passes the check until spent.
 */
async function ask(request: string, signal: AbortSignal): Promise<Answer> {
  let status: number | undefined;
  let body: unknown;
  try {
    const response = await fetch(SITEVERIFY_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: request, signal });
    status = response.status;
    body = await response.json();
  } catch (failed) {
    // The name alone: a `TimeoutError` is the bound, a `SyntaxError` a body that is no JSON, anything else the network.
    return { unanswered: { status, name: failed instanceof Error ? failed.name : "unknown" }, theirs: false };
  }

  const answer = SiteverifyAnswerSchema.safeParse(body);
  // A line leaves out a field it has no value for.
  const codes = answer.success && answer.data["error-codes"].length > 0 ? answer.data["error-codes"].join(", ") : undefined;
  // Only a 200 can judge the token: a 4xx is Cloudflare refusing our request, naming a wrong secret or a malformed request
  // in its codes, or declining to judge it, as a 429 does; a 5xx is its failing.
  if (status !== 200) return { unanswered: { status, codes }, theirs: false };
  if (!answer.success) return { unanswered: { status, name: "UnreadableAnswer" }, theirs: false };

  const { success, "error-codes": judged } = answer.data;
  if (judged.some((code) => OURS.has(code))) return { unanswered: { status, codes }, theirs: false };
  // Alone, Cloudflare's own failure judges nothing; beside any other code, the token was judged.
  const theirs = !success && judged.length > 0 && judged.every((code) => code === THEIRS);

  return theirs ? { unanswered: { status, codes }, theirs } : { passed: success };
}

/**
 * The catalogue's sentence a submission carrying `token` is refused with, or `null` where Cloudflare passed the token
 * and the submission may go on to send its mail. Only Cloudflare's judgement passes one: an answer that is none refuses
 * the press, as the browser refuses a press with no token.
 */
export async function turnstileRefusal(token: string | null): Promise<Copy | null> {
  // Refused without asking: Cloudflare would answer either with a judgement against the token.
  if (token === null || token === "" || token.length > TOKEN_MAX_LENGTH) return CONFIRM_HUMAN;

  // One key over both attempts, so Cloudflare answers a retry of one judgement rather than spending the token twice.
  const request = JSON.stringify({ secret: turnstileSecretKey(), response: token, idempotency_key: crypto.randomUUID() });
  const signal = boundCall(BOT_CHECK_WAIT_MS);
  let answer = await ask(request, signal);
  if ("theirs" in answer && answer.theirs) answer = await ask(request, signal);

  // Every judgement but a pass refuses alike, an empty list of codes included, which explains nothing.
  if ("passed" in answer) return answer.passed ? null : CONFIRM_HUMAN;

  logger.error("turnstile.check_disrupted", undefined, answer.unanswered);
  return CHECK_DISRUPTED;
}
