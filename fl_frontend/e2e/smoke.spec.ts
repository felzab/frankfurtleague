/**
 * E2E · the harness's own proof, under each project: a public page reads the made-up league, and
 * the project's administrator signs in by both ways the site offers.
 *
 * Serial: the passkey the second journey sets up is the one the third signs in with, each in a
 * browser context of its own. The authenticator is Playwright's (https://playwright.dev/docs/api/class-credentials),
 * which answers the page's own WebAuthn calls with the user-verified flag and a discoverable
 * credential, as the site's settings require; nothing in the application knows it is there.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";
import { filedMessages, mailedCode } from "./support/mailSink";

import type { BrowserContext } from "@playwright/test";

type Passkey = Awaited<ReturnType<BrowserContext["credentials"]["get"]>>[number];

/** The relying party the local `AUTH_URL` names, which is where an enrolled passkey belongs. */
const RELYING_PARTY = "localhost";

test.describe.configure({ mode: "serial" });

let passkey: Passkey | undefined;

test("a visitor reads the made-up league's Spielplan", async ({ page }) => {
  await page.goto("/dashboard/spielplan");

  // A club of the made-up league, read through the backend: the page holds the seed.
  await expect(page.getByText("Ahorn").first()).toBeVisible();
});

test("an administrator signs in with the mailed code and sets up a passkey", async ({ page, context, administrator }) => {
  await page.goto("/signin");
  await page.getByLabel("E-Mail-Adresse").fill(administrator);

  const before = await filedMessages();
  await page.getByRole("button", { name: "Code senden" }).click();
  const code = await mailedCode(administrator, before);
  await page.getByLabel("Code aus der E-Mail").pressSequentially(code);

  // The code alone does not open the Verwaltung: an administrator's first sign-in sets up a passkey.
  await expect(page).toHaveURL(/\/signin\/passkey$/);

  // Installed only now: on `/signin` the page's conditional sign-in would have asked it for a
  // passkey before it held one.
  await context.credentials.install();
  await page.reload();
  await page.getByRole("button", { name: "Jetzt einrichten" }).click();

  await expect(page).toHaveURL(/\/bereich\/admin/);
  [passkey] = await context.credentials.get({ rpId: RELYING_PARTY });
  expect(passkey, "the passkey the enrolment registered").toBeDefined();
});

test("the administrator signs in again with the passkey alone", async ({ page, context }) => {
  if (passkey === undefined) throw new Error("the journey before this one registered no passkey");

  await context.credentials.create(passkey.rpId, passkey);
  await context.credentials.install();

  // No press: `/signin` asks the browser for a passkey as it loads, and the authenticator answers.
  await page.goto("/signin");

  await expect(page).toHaveURL(/\/bereich\/admin/);
});
