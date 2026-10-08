// A module of its own so the browser's two forms and the server's two checks spell one name each,
// `fl_frontend/src/core/turnstile.ts` being server-only.

/** The sign-in form's field the bot check's token travels in. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

/** The application form's header for it: the body is the backend's payload, whose schema the token is no part of. */
export const TURNSTILE_HEADER = "X-Turnstile-Response";

/**
 * The refusal a judged token answers, whatever Cloudflare judged, so it says nothing about an address;
 * and the widget's answer to a press while it shows its own click.
 */
export const MENSCH_BESTAETIGEN = "Bitte bestätige kurz, dass Du ein Mensch bist.";
