import "server-only";

const BRAND_NAME = "Frankfurt-League";

/** Copy only. The real TTL is the Resend `maxAge` in `fl_frontend/src/core/auth.ts` — change both. */
const LINK_VALIDITY_TEXT = "15 Minuten";

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
        Klicke auf den Button, um Dich bei der ${BRAND_NAME}-Verwaltung anzumelden. Der Link ist
        <strong style="color:#0a0a0a;">${LINK_VALIDITY_TEXT}</strong> gültig und kann nur einmal
        verwendet werden.
      </p>
      <a href="${url}" style="display:inline-block;background-color:${BRAND_COLOR};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:10px;">
        Jetzt anmelden
      </a>
      <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#525252;">
        Falls der Button nicht funktioniert, kopiere diese Adresse in Deinen Browser:
      </p>
      <p style="margin:8px 0 0;font-size:12px;line-height:1.5;word-break:break-all;color:#525252;">
        ${url}
      </p>
      <hr style="border:none;border-top:1px solid #d4d4d4;margin:28px 0 16px;" />
      <p style="margin:0;font-size:12px;line-height:1.6;color:#525252;">
        Du hast diese Anmeldung nicht angefordert? Dann ignoriere diese E-Mail einfach. Ohne den
        Link passiert nichts.
      </p>
    </div>
  </body>
</html>`;
}

function renderText(url: string): string {
  return [
    `${BRAND_NAME}: Anmeldung bestätigen`,
    "",
    `Öffne diesen Link, um Dich bei der ${BRAND_NAME}-Verwaltung anzumelden.`,
    `Er ist ${LINK_VALIDITY_TEXT} gültig und kann nur einmal verwendet werden.`,
    "",
    "Ist er abgelaufen, fordere auf der Anmeldeseite einfach einen neuen an.",
    "",
    url,
    "",
    "Du hast diese Anmeldung nicht angefordert? Dann ignoriere diese E-Mail einfach.",
    "ohne den Link passiert nichts.",
  ].join("\n");
}

export function buildMagicLinkEmail(url: string): MagicLinkEmail {
  return {
    subject: `Anmeldelink für ${BRAND_NAME}`,
    html: renderHtml(url),
    text: renderText(url),
  };
}
