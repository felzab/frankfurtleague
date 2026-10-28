/**
 * E2E · signing in as a person does: the address, the code from the stack's mail sink, and a passkey
 * held by Playwright's virtual authenticator (https://playwright.dev/docs/api/class-credentials),
 * which answers the page's own WebAuthn calls with the user-verified flag and a discoverable
 * credential, as the site's settings require. Nothing in the application knows a journey is running.
 */
import { expect } from "@playwright/test";

import { filedMessages, mailedCode } from "./mailSink";

import type { BrowserContext, Locator, Page, Response } from "@playwright/test";

export type Passkey = Awaited<ReturnType<BrowserContext["credentials"]["get"]>>[number];

/** The relying party the local `AUTH_URL` names, which is where an enrolled passkey belongs. */
const RELYING_PARTY = "localhost";

/** The address step's send: Next posts a server action to the page with its id in this header. */
const isTheSend = async (response: Response): Promise<boolean> =>
  response.request().method() === "POST" && (await response.request().headerValue("next-action")) !== null;

/** The step a send that mailed a code, or would have, shows in the address step's place. */
export const codeStep = (page: Page): Locator => page.getByRole("status").filter({ hasText: "Prüfe Dein Postfach" });

/** Asks for a code on `/signin`; answers the send's response and the text of the step it shows. */
export async function askForCode(page: Page, address: string): Promise<{ response: Response; answer: string }> {
  const response = await pressSend(page, address);

  const step = codeStep(page);
  await expect(step).toBeVisible();

  return { response, answer: await step.innerText() };
}

/** Presses „Code senden“ for `address` on a fresh `/signin`; answers the send's response, whatever it answered. */
export async function pressSend(page: Page, address: string): Promise<Response> {
  await page.goto("/signin");
  const field = page.getByLabel("E-Mail-Adresse");
  // Tapped first, as a person reaches the field: React hydrates what a press lands on during the
  // press itself (https://github.com/reactwg/react-18/discussions/37). A bare `fill` into a field not
  // yet hydrated loses the address in WebKit: React's state never learns it, and its next render
  // empties the field.
  await field.click();
  await field.fill(address);

  const sent = page.waitForResponse(isTheSend);
  await page.getByRole("button", { name: "Code senden" }).click();
  return sent;
}

/** Signs in on `/signin` with the code the stack mails `address`. */
export async function signInWithCode(page: Page, address: string): Promise<void> {
  const before = await filedMessages();
  await askForCode(page, address);
  const code = await mailedCode(address, before);
  await page.getByLabel("Code aus der E-Mail").pressSequentially(code);
}

/** The account page renders for a session alone: without one it sends the visitor to `/signin`. */
export async function expectAccountPageOf(page: Page, address: string): Promise<void> {
  await page.goto("/bereich/konto");

  await expect(page).toHaveURL(/\/bereich\/konto$/);
  await expect(page.getByText(address, { exact: true })).toBeVisible();
}

/** An administrator's first passkey, set up where a code-borne sign-in lands; answers the passkey the authenticator now holds. */
export async function enrolPasskey(page: Page, context: BrowserContext): Promise<Passkey> {
  // The code alone does not open the Verwaltung: an administrator's first sign-in sets up a passkey.
  await expect(page).toHaveURL(/\/signin\/passkey$/);

  // Installed only now: on `/signin` the page's conditional sign-in would have asked it for a passkey
  // before it held one.
  await context.credentials.install();
  await page.reload();
  await page.getByRole("button", { name: "Jetzt einrichten" }).click();
  // Every administrator lands on the Übersicht, which a session short of the passkey would leave for
  // `/bereich/admin` and the passkey step (`fl_frontend/src/core/auth.ts :: destinationOf`).
  await expect(page).toHaveURL(/\/bereich$/);

  const [passkey] = await context.credentials.get({ rpId: RELYING_PARTY });
  if (passkey === undefined) throw new Error("the enrolment left the authenticator holding no passkey");
  return passkey;
}
