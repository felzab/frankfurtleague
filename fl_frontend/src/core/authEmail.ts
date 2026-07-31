import "server-only";

/**
 * The magic-link email. **This file is the one place to edit what admins receive.**
 *
 * Auth.js ships a default template and, until this existed, that is what went out: an English
 * subject ("Sign in to …") and a generic body, on a German-only site. `core/auth.ts` passes
 * `sendVerificationRequest` to the Resend provider, which replaces that default with the functions
 * below — see `buildMagicLinkEmail`.
 *
 * It lives in `core/` rather than beside the rest of the auth feature because `core/auth.ts` is what
 * consumes it, and `core` may not import from `features` (the Wave 1 layer rule, which caught this
 * on the first attempt).
 *
 * ## How to customise it
 *
 * - **Wording, subject, sender name** — edit the constants and template strings below. Nothing else
 *   imports them, so a change here cannot affect anything but the email.
 * - **Layout** — edit `renderHtml`. Keep it to table-free, inline-styled HTML: Gmail strips `<style>`
 *   blocks and Outlook ignores most modern CSS, so inline `style=""` on each element is the only
 *   thing that renders reliably across clients. Do not import the app's Tailwind classes here — the
 *   stylesheet does not travel with the email.
 * - **Plain-text part** — edit `renderText`. Always send one. A message with no text alternative
 *   scores badly with spam filters, and some clients show it in previews.
 *
 * ## What not to change without thinking
 *
 * - The link must be `url` exactly as passed. It carries a single-use token; rewriting, shortening
 *   or appending to it invalidates the sign-in.
 * - Do not put the recipient's address in the subject, and do not add tracking pixels or link
 *   wrappers: this is an authentication email, and both leak that the address is an allowlisted
 *   admin to anyone who can see the traffic.
 */

const BRAND_NAME = "Frankfurt-League";

/** How long the link stays valid, for the copy only — the real TTL is Auth.js's `maxAge`. */
const LINK_VALIDITY_TEXT = "24 Stunden";

/** Deep red from `--accent-brand-solid`. Hardcoded on purpose: CSS variables do not exist in email. */
const BRAND_COLOR = "#82181a";

export type MagicLinkEmail = { subject: string; html: string; text: string };

function renderHtml(url: string): string {
  return `<!doctype html>
<html lang="de">
  <body style="margin:0;padding:24px;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:12px;padding:32px;">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#525252;font-weight:700;">
        ${BRAND_NAME}
      </p>
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0a0a0a;font-weight:800;">
        Anmeldung bestätigen
      </h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#525252;">
        Klicke auf den Button, um dich bei der ${BRAND_NAME}-Verwaltung anzumelden. Der Link ist
        ${LINK_VALIDITY_TEXT} gültig und kann nur einmal verwendet werden.
      </p>
      <a href="${url}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:10px;">
        Jetzt anmelden
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#525252;">
        Falls der Button nicht funktioniert, kopiere diese Adresse in deinen Browser:
      </p>
      <p style="margin:8px 0 0;font-size:12px;line-height:1.5;word-break:break-all;color:#525252;">
        ${url}
      </p>
      <hr style="border:none;border-top:1px solid #d4d4d4;margin:28px 0 16px;" />
      <p style="margin:0;font-size:12px;line-height:1.6;color:#525252;">
        Du hast diese Anmeldung nicht angefordert? Dann ignoriere diese E-Mail einfach — ohne den
        Link passiert nichts.
      </p>
    </div>
  </body>
</html>`;
}

function renderText(url: string): string {
  return [
    `${BRAND_NAME} — Anmeldung bestätigen`,
    "",
    `Öffne diesen Link, um dich bei der ${BRAND_NAME}-Verwaltung anzumelden.`,
    `Er ist ${LINK_VALIDITY_TEXT} gültig und kann nur einmal verwendet werden.`,
    "",
    url,
    "",
    "Du hast diese Anmeldung nicht angefordert? Dann ignoriere diese E-Mail einfach —",
    "ohne den Link passiert nichts.",
  ].join("\n");
}

/** Builds the whole message. Called by `core/auth.ts`'s `sendVerificationRequest`. */
export function buildMagicLinkEmail(url: string): MagicLinkEmail {
  return {
    subject: `Anmeldelink für ${BRAND_NAME}`,
    html: renderHtml(url),
    text: renderText(url),
  };
}
