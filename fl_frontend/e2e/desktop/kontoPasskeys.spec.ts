/**
 * E2E · J8's passkeys on Konto: a person sets one up and removes it behind the passkey touch, which ends the
 * session this device's set-up signed in, and the page leaves for the sign-in. Then a passkey holder starts an address
 * change and deletes the account, each behind its own touch. Desktop alone, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { filedMessages, mailedLink } from "../support/mailSink";
import { signInWithCode } from "../support/signIn";

import type { BrowserContext } from "@playwright/test";

/** The person the removal's journey alone signs in as (`scripts/ops/seed/seed.js`). */
const REMOVER = "emil.ernst@example.com";

/** The person the touched acts' journey alone signs in as, and the one its last step erases. */
const HOLDER = "jana.jansen@example.com";

/** The relying party the local `AUTH_URL` names. */
const RELYING_PARTY = "localhost";

/**
 * The assertions the browser's authenticator has signed for the site: its signature counter rises by one on each
 * (https://playwright.dev/docs/api/class-credentials#credentials-create-option-sign-count), so a press behind the touch
 * moves it by exactly one, and an act whose end shows ran past the touch that moved it.
 */
async function assertionsSigned(context: BrowserContext): Promise<number> {
  return (await context.credentials.get({ rpId: RELYING_PARTY })).reduce((signed, passkey) => signed + passkey.signCount, 0);
}

test("a person's passkey on Sicherheit: set up, then removed, which ends this device's session", async ({ page, context }) => {
  await signInWithCode(page, REMOVER);
  await expect(page).toHaveURL(/\/signin\/passkey/);
  await page.getByRole("button", { name: "Später" }).click();

  await context.credentials.install();
  await page.goto("/account/security");
  const rows = () => page.getByRole("button", { name: "Löschen" });

  // The passkey, on the code's fresh session alone: nobody holds one yet, so nothing is touched.
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(rows()).toHaveCount(1);

  // Removed on its own touch: this device's session goes with it, and the browser leaves for the sign-in.
  const beforeTheRemoval = await assertionsSigned(context);
  await rows().first().click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/signin");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
  expect(await assertionsSigned(context), "the removal of this device's passkey asked no touch of its own").toBe(beforeTheRemoval + 1);
});

test("a passkey holder's address change and deletion each run behind the touch", async ({ page, context }) => {
  await signInWithCode(page, HOLDER);
  await expect(page).toHaveURL(/\/signin\/passkey/);
  await page.getByRole("button", { name: "Später" }).click();

  // A passkey, set up on the code's fresh session: the person holds none yet, so nothing is touched.
  await context.credentials.install();
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(page.getByRole("button", { name: "Löschen" })).toHaveCount(1);

  // The change's start asks the touch before it posts, and stands as the pending change its box then shows.
  await page.goto("/account/signin");
  await page.getByLabel("Neue E-Mail-Adresse").fill(HOLDER.replace("@", ".neu@"));
  const beforeTheStart = await assertionsSigned(context);
  await page.getByRole("button", { name: "Link senden" }).click();
  const withdraw = page.getByRole("button", { name: "Änderung zurückziehen" });
  await expect(withdraw).toBeVisible();
  expect(await assertionsSigned(context), "the address change's start asked no touch").toBe(beforeTheStart + 1);
  await withdraw.click();
  await expect(page.getByRole("button", { name: "Link senden" })).toBeVisible();

  // The deletion's link, mailed from Konto, and its act behind the touch.
  const before = await filedMessages();
  await page.getByRole("button", { name: "Konto löschen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  const link = await mailedLink(HOLDER, "Konto löschen", before);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Konto löschen" })).toBeVisible();
  const beforeTheDeletion = await assertionsSigned(context);
  await page.getByRole("main").getByRole("button", { name: "Konto löschen" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/erasure/done");
  await expect(page.getByRole("heading", { name: "Konto gelöscht" })).toBeVisible();
  expect(await assertionsSigned(context), "the deletion asked no touch").toBe(beforeTheDeletion + 1);
});
