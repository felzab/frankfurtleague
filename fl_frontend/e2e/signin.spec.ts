/**
 * E2E · signing in, under each project: by the mailed code, proven by a page that renders only for a
 * session; and asking for a code, which tells nobody who is a member. The passkey ceremonies are in
 * `desktop/passkey.spec.ts`, for the reason `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";
import { askForCode, expectAccountPageOf, signInWithCode } from "./support/signIn";

/** The owner's grant, which no journey signs in with: asking for its code disturbs no other journey. */
const MEMBER = "inhaber@example.com";

/** An address no record of the made-up league holds. */
const STRANGER = "niemand@example.com";

test("asking for a code sets no cookie and answers a member and a stranger alike", async ({ page, context, baseURL }) => {
  const answers: string[] = [];

  for (const address of [MEMBER, STRANGER]) {
    const { response, answer } = await askForCode(page, address);

    expect(await response.headerValue("set-cookie"), `the send for ${address} set a cookie`).toBeNull();
    // Every cookie the site holds, whatever request set it, by name alone: a signed-out visitor holds none
    // until a passkey ceremony starts, which nothing here presses. Scoped to the site, since the bot check
    // loads from another host, whose cookies are not the site's; never left unscoped, which reads them all.
    const names = (await context.cookies(String(baseURL))).map((cookie) => cookie.name);
    expect(names, `the site's cookies after the send for ${address}`).toEqual([]);
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
