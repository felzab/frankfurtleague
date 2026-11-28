/**
 * E2E · asking for a sign-in code sets the browser the same cookies for a member as for a stranger, and no session, so
 * no cookie tells the two apart. Desktop alone: which cookies the server sets is no engine's, and every phone journey
 * that signs in asks for a code too. The code sign-in itself is walked by every journey that signs in, and the passkey
 * ceremonies run in a journey of their own.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { PEOPLE } from "../support/madeUpLeague";
import { askForCode } from "../support/signIn";

/** A grant no journey signs in with: asking for its code disturbs no other journey. */
const MEMBER = PEOPLE.administrators.successor;

/** An address no record of the made-up league holds. */
const STRANGER = "niemand@example.com";

test("asking for a code sets the same cookies, and no session, for a member and a stranger", async ({ page, context, baseURL }) => {
  const named: string[][] = [];
  for (const address of [MEMBER, STRANGER]) {
    // Each ask from a browser holding nothing, so what it holds afterwards is what that ask set.
    await context.clearCookies();
    await askForCode(page, address);

    // Every cookie the site holds after the ask, by name alone: nothing here presses a passkey ceremony, whose cookie
    // would stand beside it. Scoped to the site, whose cookies these are.
    named.push((await context.cookies(String(baseURL))).map((cookie) => cookie.name).sort());
  }

  const [member, stranger] = named;
  expect(member, "the ask set no cookie, so the code check would refuse every code").toHaveLength(1);
  expect(stranger, "a member's ask and a stranger's set different cookies").toEqual(member);
  expect(
    member?.filter((name) => name.endsWith(".session_token")),
    "the ask set a session",
  ).toEqual([]);
});
