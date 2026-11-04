/**
 * E2E · J8's passkeys on Konto's Sicherheit: a person sets up two, renames one and removes both, each removal asking
 * the passkey touch first. The removal of a passkey another device signed in with renders the page again with the
 * row gone; the removal of the passkey this device's session was made by renders nothing again, since that page would
 * render under a session the removal ended, and the page leaves by a document load. Desktop alone, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { signInWithCode } from "../support/signIn";

import type { Page, Response } from "@playwright/test";

/** The relying party the local `AUTH_URL` names. */
const RELYING_PARTY = "localhost";

/** The next server action's answer the page posts, which carries what Next rendered with it. */
const nextAction = (page: Page): Promise<Response> =>
  page.waitForResponse(
    async (response) => response.request().method() === "POST" && (await response.request().headerValue("next-action")) !== null,
  );

test("a person's passkeys on Sicherheit: set up, renamed, and removed with and without this device's session", async ({
  page,
  context,
  person,
}) => {
  await signInWithCode(page, person);
  await expect(page).toHaveURL(/\/signin\/passkey/);
  await page.getByRole("button", { name: "Später" }).click();

  await context.credentials.install();
  await page.goto("/account/security");
  const rows = () => page.getByRole("button", { name: "Löschen" });

  // The first passkey, on the code's fresh session alone: nobody holds one yet, so nothing is touched.
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(rows()).toHaveCount(1);
  const [first] = await context.credentials.get({ rpId: RELYING_PARTY });
  if (first === undefined) throw new Error("the set-up left the authenticator holding no passkey");

  // The second, on the touch with the first: the browser is asked to exclude the first, so the authenticator lets go of
  // it once the touch has signed in and before the set-up's own prompt, and holds the second alone afterwards. The first
  // is kept as the touch left it: its assertion moved the signature counter the site stores, and a passkey seeded again
  // at an older count answers at most that count, which the site refuses as a cloned authenticator's.
  let touched = first;
  await page.route("**/api/auth/passkey/generate-register-options*", async (route) => {
    const [held] = await context.credentials.get({ id: first.id });
    if (held === undefined) throw new Error("the authenticator let go of the first passkey before the set-up asked for options");
    touched = held;
    await context.credentials.delete(first.id);
    await route.continue();
  });
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(rows()).toHaveCount(2);
  await page.unrouteAll();
  const [second] = await context.credentials.get({ rpId: RELYING_PARTY });
  if (second === undefined) throw new Error("the second set-up left the authenticator holding no passkey");

  // The rename, in its dialog: the row shows the new name.
  await page.getByRole("button", { name: "Umbenennen" }).first().click();
  const rename = page.getByRole("dialog");
  await rename.getByLabel("Name").fill("Laptop");
  await rename.getByRole("button", { name: "Umbenennen" }).click();
  await expect(page.getByText("Laptop", { exact: true })).toBeVisible();

  // The second passkey removed on the touch with the first: another device's, so the action renders the page again.
  await context.credentials.delete(second.id);
  await context.credentials.create(RELYING_PARTY, touched);
  await rows().nth(1).click();
  const otherAnswer = nextAction(page);
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  const other = await otherAnswer;
  expect(await other.headerValue("x-action-revalidated"), "another device's removal rendered the page not again").not.toBeNull();
  await expect(rows()).toHaveCount(1);
  await expect(page).toHaveURL(/\/account\/security$/);

  // The first removed on its own touch: this device's session goes with it, so the answer renders no page and the
  // browser leaves for the sign-in as a new document.
  await rows().first().click();
  const ownAnswer = nextAction(page);
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  const own = await ownAnswer;
  expect(await own.headerValue("x-action-revalidated"), "the removal ending this device's session rendered a page again").toBeNull();
  expect(await own.text(), "the answer carries a render of Sicherheit").not.toContain("Alle anderen abmelden");
  await expect(page).toHaveURL(/\/signin$/);
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
});
