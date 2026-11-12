// A module of its own so the browser's forms and the server's checks spell one name each, the bot check's
// module being server-only.

import { COPY } from "./copy";

export const TURNSTILE_FIELD = "cf-turnstile-response";

/**
 * The refusal a judged token answers, whatever Cloudflare judged, so it says nothing about an address;
 * and the widget's answer to a press while it shows its own click.
 */
export const CONFIRM_HUMAN = COPY.shared.botCheck;
