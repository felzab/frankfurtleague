/**
 * E2E · an administrator's passkey, set up after the mailed code and then signed in with alone, each
 * sign-in proven by a page that renders only for a session. Desktop alone, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { enrolPasskey, expectAccountPageOf, signInWithCode } from "../support/signIn";

import type { Passkey } from "../support/signIn";

// The passkey the first journey sets up is the one the second signs in with, each in a browser context of its own.
test.describe.configure({ mode: "serial" });

let passkey: Passkey | undefined;

test("an administrator signs in with the mailed code and sets up a passkey", async ({ page, context, administrator }) => {
  await signInWithCode(page, administrator);
  passkey = await enrolPasskey(page, context);
});

test("the administrator signs in again with the passkey alone and their account page renders", async ({ page, context, administrator }) => {
  if (passkey === undefined) throw new Error("the journey before this one registered no passkey");

  await context.credentials.create(passkey.rpId, passkey);
  await context.credentials.install();

  // No press: `/signin` asks the browser for a passkey as it loads, and the authenticator answers.
  await page.goto("/signin");
  // The Übersicht, where `enrolPasskey` lands the code-borne sign-in too.
  await expect(page).toHaveURL(/\/bereich$/);

  await expectAccountPageOf(page, administrator);
});
