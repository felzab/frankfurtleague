/**
 * E2E · asking for a sign-in code sets the browser no cookie, for a member or a stranger, so no cookie tells the two
 * apart. Desktop alone: which cookies the server sets is no engine's, and every phone journey that signs in asks for a
 * code too. The code sign-in itself is walked by every journey that signs in, and the passkey ceremonies are in
 * `passkey.spec.ts`.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { askForCode } from "../support/signIn";

/** A grant no journey signs in with: asking for its code disturbs no other journey. */
const MEMBER = "admin.nachfolge@example.com";

/** An address no record of the made-up league holds. */
const STRANGER = "niemand@example.com";

test("asking for a code sets no cookie, for a member or a stranger", async ({ page, context, baseURL }) => {
  for (const address of [MEMBER, STRANGER]) {
    await askForCode(page, address);

    // Every cookie the site holds, whatever request set it, by name alone: a signed-out visitor holds none
    // until a passkey ceremony starts, which nothing here presses. Scoped to the site, whose cookies these are.
    const names = (await context.cookies(String(baseURL))).map((cookie) => cookie.name);
    expect(names, `the site's cookies after the send for ${address}`).toEqual([]);
  }
});
