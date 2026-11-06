/**
 * E2E · the one administrator's session every administration journey shares, set up once before any of them
 * (https://playwright.dev/docs/auth#basic-shared-account-in-all-tests). Desktop's Chromium signs in, since the Verwaltung
 * takes a passkey session alone and WebKit holds no authenticator (`fl_frontend/playwright.config.ts`). The session is
 * then the phone's too: it is bound to no browser, so WebKit at an iPhone's size reads the same pages under it. Each
 * journey writes a record of its own, so sharing it costs no journey anything another reads.
 */
import { ADMINISTRATOR_STATE, test } from "./journey";
import { enrolPasskey, signInWithCode } from "./signIn";

/** The administrator these journeys sign in as (`scripts/ops/seed/seed.js`), and no other journey. */
const ADMINISTRATOR = "admin@example.com";

test("the administration's session", async ({ page, context }) => {
  await signInWithCode(page, ADMINISTRATOR);
  await enrolPasskey(page, context);

  await context.storageState({ path: ADMINISTRATOR_STATE });
});
