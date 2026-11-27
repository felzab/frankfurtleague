/**
 * E2E · an administrator's passkey, where no lower tier sees a passkey set up after the mailed code fail to sign in
 * alone. Desktop alone: Playwright's WebKit has no WebAuthn of its own, so a phone ceremony would test its stand-in.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { ADMINISTRATION_LANDING, enrolPasskey, expectAccountPageOf, signInWithCode } from "../support/signIn";

test("an administrator sets up a passkey after the mailed code, and signs in again with it alone", async ({ page, context, administrator }) => {
  await signInWithCode(page, administrator);
  await enrolPasskey(page, context);

  // The session goes and the authenticator stays, as a person signing in again on the same device holds it.
  await context.clearCookies();

  // The passkey by its button alone, on the sign-in an administrator opening the administration is sent to: the press
  // asks the browser for one, and the authenticator answers.
  await page.goto(ADMINISTRATION_LANDING);
  await expect(page).toHaveURL((url) => url.pathname === "/signin" && url.searchParams.get("return") === ADMINISTRATION_LANDING);
  await page.getByRole("button", { name: "Mit Passkey anmelden" }).click();
  // The Übersicht, where `enrolPasskey` lands the code-borne sign-in too.
  await expect(page).toHaveURL((url) => url.pathname === ADMINISTRATION_LANDING);

  await expectAccountPageOf(page, administrator);
});
