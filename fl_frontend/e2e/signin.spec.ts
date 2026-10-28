/**
 * E2E · signing in, under each project: by the mailed code, proven by a page that renders only for a
 * session; and asking for a code, which tells nobody who is a member. The passkey ceremonies are in
 * `desktop/passkey.spec.ts`, for the reason `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";
import { askForCode, expectAccountPageOf, signInWithCode } from "./support/signIn";

import type { Cookie } from "@playwright/test";

/** The owner's grant, which no journey signs in with: asking for its code disturbs no other journey. */
const MEMBER = "inhaber@example.com";

/** An address no record of the made-up league holds. */
const STRANGER = "niemand@example.com";

/** The sign-in library's session cookie, whatever prefix the origin gives it (`fl_frontend/src/core/auth.ts :: cookieNaming`). */
const sessionCookies = (cookies: readonly Cookie[]): string[] =>
  cookies.filter((cookie) => cookie.name.endsWith(".session_token")).map((cookie) => cookie.name);

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
