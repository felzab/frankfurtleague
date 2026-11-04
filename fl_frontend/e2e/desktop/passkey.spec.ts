/**
 * E2E · an administrator's passkey, set up after the mailed code and then signed in with alone on a browser holding no
 * session, each sign-in proven by a page that renders only for a session. Desktop alone, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { enrolPasskey, expectAccountPageOf, signInWithCode } from "../support/signIn";

test("an administrator sets up a passkey after the mailed code, and signs in again with it alone", async ({ page, context, administrator }) => {
  await signInWithCode(page, administrator);
  await enrolPasskey(page, context);

  // The session goes and the authenticator stays, as a person signing in again on the same device holds it.
  await context.clearCookies();

  // The passkey by its button alone: the press asks the browser for one, and the authenticator answers.
  await page.goto("/signin");
  await page.getByRole("button", { name: "Mit Passkey anmelden" }).click();
  // The Übersicht, where `enrolPasskey` lands the code-borne sign-in too.
  await expect(page).toHaveURL((url) => url.pathname === "/area");

  await expectAccountPageOf(page, administrator);
});
