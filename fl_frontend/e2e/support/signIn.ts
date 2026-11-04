/**
 * E2E · signing in as a person does: the address, the code from the stack's mail sink, and a passkey
 * held by Playwright's virtual authenticator (https://playwright.dev/docs/api/class-credentials),
 * which answers the page's own WebAuthn calls with the user-verified flag and a discoverable
 * credential, as the site's settings require. Nothing in the application knows a journey is running.
 */
import { expect } from "@playwright/test";

import { filedMessages, mailedCode } from "./mailSink";

import type { BrowserContext, Locator, Page } from "@playwright/test";

export type Passkey = Awaited<ReturnType<BrowserContext["credentials"]["get"]>>[number];

/** The relying party the local `AUTH_URL` names, which is where an enrolled passkey belongs. */
const RELYING_PARTY = "localhost";

/** The step a send that mailed a code, or would have, shows in the address step's place. */
export const codeStep = (page: Page): Locator => page.getByRole("status").filter({ hasText: "Prüfe dein Postfach" });

/** The sign-in's one line under its acts, where a send that did not go through says why: a polite status. */
export const failureLine = (page: Page): Locator => page.getByRole("status");

/** Asks for a code on `/signin`, as far as the step a send that mailed one shows. */
export async function askForCode(page: Page, address: string): Promise<void> {
  await pressSend(page, address);
  await expect(codeStep(page)).toBeVisible();
}

/** Presses „Code senden“ for `address` on a fresh `/signin`, whatever the send then answers. */
export async function pressSend(page: Page, address: string): Promise<void> {
  await page.goto("/signin");
  await sendFromHere(page, address);
}

/** Signs in with the code the stack mails `address`, on the sign-in page the browser stands on, its return address kept. */
export async function signInWithCodeHere(page: Page, address: string): Promise<void> {
  const before = await filedMessages();
  await sendFromHere(page, address);
  await expect(codeStep(page)).toBeVisible();
  const code = await mailedCode(address, before);
  await page.getByRole("textbox", { name: "Code aus der E-Mail" }).pressSequentially(code);
}

/** Presses „Code senden“ for `address` on the sign-in page the browser stands on. */
async function sendFromHere(page: Page, address: string): Promise<void> {
  const field = page.getByLabel("E-Mail-Adresse");
  // Tapped first, as a person reaches the field: React hydrates what a press lands on during the
  // press itself (https://github.com/reactwg/react-18/discussions/37). A bare `fill` into a field not
  // yet hydrated loses the address in WebKit: React's state never learns it, and its next render
  // empties the field.
  await field.click();
  await field.fill(address);

  await page.getByRole("button", { name: "Code senden" }).click();
}

/** Signs in on `/signin` with the code the stack mails `address`. */
export async function signInWithCode(page: Page, address: string): Promise<void> {
  const before = await filedMessages();
  await askForCode(page, address);
  const code = await mailedCode(address, before);
  // Typed into the code's one input, a digit at a time as a person's typing is; the sixth sends the code by
  // itself.
  await page.getByRole("textbox", { name: "Code aus der E-Mail" }).pressSequentially(code);
}

/**
 * The session cookies the browser holds for the site, by name: the library's, under whatever prefix the origin gives
 * it, as `fl_frontend/src/proxy.ts` matches it. Scoped to the site, since the bot check loads from another host.
 */
export async function sessionCookies(context: BrowserContext, site: string | undefined): Promise<string[]> {
  return (await context.cookies(String(site))).map((cookie) => cookie.name).filter((name) => name.endsWith(".session_token"));
}

/** Konto's Anmeldung renders for a session alone: without one it sends the visitor to `/signin`. */
export async function expectAccountPageOf(page: Page, address: string): Promise<void> {
  await page.goto("/account/signin");

  await expect(page).toHaveURL(/\/account\/signin$/);
  // The page's own E-Mail-Adresse box, in `main`: the rail's account row outside it names the address too.
  await expect(page.getByRole("main").getByText(address, { exact: true })).toBeVisible();
}

/** An administrator's first passkey, set up where a code-borne sign-in lands; answers the passkey the authenticator now holds. */
export async function enrolPasskey(page: Page, context: BrowserContext): Promise<Passkey> {
  // The code alone does not open the Verwaltung: an administrator's first sign-in sets up a passkey.
  await expect(page).toHaveURL(/\/signin\/passkey$/);

  // Installed only now, on the page whose ceremony it answers, and the page loaded again under it.
  await context.credentials.install();
  await page.reload();
  await page.getByRole("button", { name: "Jetzt einrichten" }).click();
  // Every administrator lands on the Übersicht, which a session short of the passkey would leave for
  // `/area/admin` and the passkey step (`fl_frontend/src/core/auth/landing.ts :: destinationOf`).
  await expect(page).toHaveURL(/\/area$/);

  const [passkey] = await context.credentials.get({ rpId: RELYING_PARTY });
  if (passkey === undefined) throw new Error("the enrolment left the authenticator holding no passkey");
  return passkey;
}
