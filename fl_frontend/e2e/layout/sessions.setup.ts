/**
 * E2E · the sessions the layout guard reads its signed-in pages under, one per role a code signs in, each set up once a
 * run as Playwright's guide sets up several roles (https://playwright.dev/docs/auth#multiple-signed-in-roles). Signed in
 * from a worker of the guard itself, a session would be signed in again after each failed case, since Playwright starts
 * a new worker then, and the stack stops mailing codes to an address that asks for them that often.
 */
import { test } from "../support/journey";
import { sessionFile, SIGNED_IN_BY_CODE } from "../support/layoutShift";
import { declinePasskeyOffer, signInWithCode } from "../support/signIn";

for (const role of Object.keys(SIGNED_IN_BY_CODE) as (keyof typeof SIGNED_IN_BY_CODE)[]) {
  test(`the ${role}'s session`, async ({ page, context }) => {
    const { address, landing } = SIGNED_IN_BY_CODE[role];
    await signInWithCode(page, address);
    await declinePasskeyOffer(page, landing);

    await context.storageState({ path: sessionFile(role) });
  });
}
