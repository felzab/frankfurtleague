/**
 * E2E · asking for a sign-in code, under each project, which sets the browser no cookie for a member or a stranger. The
 * code sign-in itself is walked by every journey that signs in, and the passkey ceremonies are in
 * `desktop/passkey.spec.ts`, for the reason `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";
import { askForCode } from "./support/signIn";

/** The owner's grant, which no journey signs in with: asking for its code disturbs no other journey. */
const MEMBER = "inhaber@example.com";

/** An address no record of the made-up league holds. */
const STRANGER = "niemand@example.com";

test("asking for a code sets no cookie, for a member or a stranger", async ({ page, context, baseURL }) => {
  for (const address of [MEMBER, STRANGER]) {
    await askForCode(page, address);

    // Every cookie the site holds, whatever request set it, by name alone: a signed-out visitor holds none
    // until a passkey ceremony starts, which nothing here presses. Scoped to the site, since the bot check
    // loads from another host, whose cookies are not the site's; never left unscoped, which reads them all.
    const names = (await context.cookies(String(baseURL))).map((cookie) => cookie.name);
    expect(names, `the site's cookies after the send for ${address}`).toEqual([]);
  }
});
