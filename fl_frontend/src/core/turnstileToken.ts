// A module of its own so the browser's forms and the server's checks spell one name each,
// `fl_frontend/src/core/turnstile.ts` being server-only.

import { COPY } from "./copy";

/** The field a form posting to a server action carries the bot check's token in. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

/**
 * The refusal a judged token answers, whatever Cloudflare judged, so it says nothing about an address;
 * and the widget's answer to a press while it shows its own click.
 */
export const CONFIRM_HUMAN = COPY.shared.botCheck;
