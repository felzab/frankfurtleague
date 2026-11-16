/**
 * E2E · Cloudflare's bot check as a journey meets it: this script in place of Cloudflare's widget, since a journey tests
 * what the league's stack does rather than a page Cloudflare serves (https://playwright.dev/docs/best-practices#avoid-testing-third-party-dependencies).
 * The check's server half is the real one: the frontend asks Cloudflare to judge the token under the published test
 * secret, which passes it.
 *
 * It answers the three calls `fl_frontend/src/kit/useBotCheck.tsx` makes of `window.turnstile`, and a widget
 * mints as the published test site keys do (https://developers.cloudflare.com/turnstile/troubleshooting/testing/): on
 * render and on each reset, after the call has returned, the one dummy token. The browser still takes the script from
 * Cloudflare's address, under the edge's Content-Security-Policy. Nothing in the application knows a journey is running.
 */
import type { BrowserContext } from "@playwright/test";

const STAND_IN = `
const widgets = new Map();
const mint = (id) => setTimeout(() => widgets.get(id)?.callback("XXXX.DUMMY.TOKEN.XXXX"));
window.turnstile = {
  render(container, options) {
    const id = crypto.randomUUID();
    widgets.set(id, options);
    mint(id);
    return id;
  },
  reset: mint,
  remove: (id) => widgets.delete(id),
};
`;

/**
 * Every request `context` sends to Cloudflare's address, whatever its path, so a script address moved in the
 * application cannot return a journey to the network. Each context needs its own: a route is one context's alone.
 */
export async function standInForTurnstile(context: BrowserContext): Promise<void> {
  await context.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "text/javascript", body: STAND_IN }));
}
