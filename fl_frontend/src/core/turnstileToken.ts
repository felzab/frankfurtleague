// A module of its own so the browser's forms and the server's checks spell one name each, the bot check's
// module being server-only.

import { COPY } from "./copy/shared";

export const TURNSTILE_FIELD = "cf-turnstile-response";

/**
 * How long either half of the check waits: a press for a token being minted, and the server for Cloudflare's verdict
 * over both its attempts. Cloudflare's own example's bound, from
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/; past it the press is refused
 * rather than waiting longer.
 */
export const BOT_CHECK_WAIT_MS = 10_000;

/**
 * The refusal a judged token answers, whatever Cloudflare judged, so it says nothing about an address;
 * and the widget's answer to a press while it shows its own click.
 */
export const CONFIRM_HUMAN = COPY.shared.botCheck;
