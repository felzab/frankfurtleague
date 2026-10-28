/**
 * E2E · signing in, under each project: by the mailed code, then by a passkey, each sign-in proven by
 * a page that renders only for a session; and asking for a code, which tells nobody who is a member.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";
import { askForCode, enrolPasskey, signInWithCode } from "./support/signIn";

import type { Cookie, Page } from "@playwright/test";
import type { Passkey } from "./support/signIn";

/** The owner's grant, which no journey signs in with: asking for its code disturbs no other journey. */
const MEMBER = "inhaber@example.com";

/** An address no record of the made-up league holds. */
const STRANGER = "niemand@example.com";

/** The sign-in library's session cookie, whatever prefix the origin gives it (`fl_frontend/src/core/auth.ts :: cookieNaming`). */
const sessionCookies = (cookies: readonly Cookie[]): string[] =>
  cookies.filter((cookie) => cookie.name.endsWith(".session_token")).map((cookie) => cookie.name);

/** The account page renders for a session alone: without one it sends the visitor to `/signin`. */
async function expectAccountPageOf(page: Page, address: string): Promise<void> {
  await page.goto("/bereich/konto");

  await expect(page).toHaveURL(/\/bereich\/konto$/);
  await expect(page.getByText(address, { exact: true })).toBeVisible();
}

test("asking for a code sets no cookie and answers a member and a stranger alike", async ({ page, context }) => {
  const answers: string[] = [];

  for (const address of [MEMBER, STRANGER]) {
    const { response, answer } = await askForCode(page, address);

    expect(await response.headerValue("set-cookie"), `the send for ${address} set a cookie`).toBeNull();
    expect(sessionCookies(await context.cookies()), `a session cookie after the send for ${address}`).toEqual([]);
    // The step names the address it was asked for, and nothing else in it may differ.
    answers.push(answer.replaceAll(address, "<Adresse>"));
  }

  expect(answers[1], "the stranger's answer differs from the member's").toBe(answers[0]);
});

test("a person signs in with the mailed code and their account page renders", async ({ page, person }) => {
  await signInWithCode(page, person);

  // A person is offered a passkey first, which this journey leaves for later.
  await expect(page).toHaveURL(/\/signin\/passkey$/);

  await expectAccountPageOf(page, person);
});

test.describe("an administrator's passkey", () => {
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
    await expect(page).toHaveURL(/\/bereich\/admin/);

    await expectAccountPageOf(page, administrator);
  });
});
