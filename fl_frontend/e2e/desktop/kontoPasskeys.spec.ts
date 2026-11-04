/**
 * E2E · J8's passkeys on Konto: a person sets up two, renames one and removes both, each removal asking the passkey
 * touch first. The removal of a passkey another device signed in with renders the page again with the row gone; the
 * removal of the passkey this device's session was made by renders nothing again, since that page would render under
 * a session the removal ended, and the page leaves by a document load. Then the same person, holding a passkey again,
 * starts an address change and deletes the account, each behind its own touch. Desktop alone, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { filedMessages, mailedLink } from "../support/mailSink";
import { signInWithCode } from "../support/signIn";

import type { Page, Response } from "@playwright/test";

/** The person this journey alone signs in as (`scripts/ops/seed/seed.js`), and the one its last step erases. */
const HOLDER = "emil.ernst@example.com";

/** The relying party the local `AUTH_URL` names. */
const RELYING_PARTY = "localhost";

/** The passkey's assertion, which the touch posts before the act it guards. */
const TOUCH_PATH = "/api/auth/passkey/verify-authentication";

// The second journey runs on the account the first leaves: holding no passkey, signed out.
test.describe.configure({ mode: "serial" });

/** A touched act's answer, kept whole: the passkey assertions answered between the press and the act's post, and the post's answer. */
type Pressed = { readonly touches: number; readonly headers: Readonly<Record<string, string>>; readonly body: string };

/**
 * Presses an act behind the touch on the page at `pathname`, and answers what its server action sent back. The answer
 * is fetched through the route and handed on to the page, so its body is read before the page acts on it: an act
 * ending this device's session leaves by a document load, which discards a response the browser fetched itself.
 */
async function pressBehindTheTouch(page: Page, pathname: string, press: () => Promise<void>): Promise<Pressed> {
  let touches = 0;
  const counted = (response: Response) => {
    if (response.request().method() === "POST" && new URL(response.url()).pathname === TOUCH_PATH && response.ok()) touches += 1;
  };
  page.on("response", counted);

  let answered: (pressed: Pressed) => void = () => undefined;
  const pressed = new Promise<Pressed>((resolve) => {
    answered = resolve;
  });
  const theAct = (url: URL) => url.pathname === pathname;
  await page.route(theAct, async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || (await request.headerValue("next-action")) === null) {
      await route.fallback();
      return;
    }
    // Counted as the act is sent: a touch answered after it is no touch for it.
    const before = touches;
    const response = await route.fetch();
    answered({ touches: before, headers: response.headers(), body: await response.text() });
    await route.fulfill({ response });
  });

  await press();
  const answer = await pressed;
  await page.unroute(theAct);
  page.off("response", counted);
  return answer;
}

test("a person's passkeys on Sicherheit: set up, renamed, and removed with and without this device's session", async ({ page, context }) => {
  await signInWithCode(page, HOLDER);
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
  const other = await pressBehindTheTouch(page, "/account/security", async () => {
    await rows().nth(1).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  });
  expect(other.touches, "another device's removal asked no touch of its own").toBe(1);
  expect(other.headers["x-action-revalidated"], "another device's removal rendered the page not again").toBeDefined();
  await expect(rows()).toHaveCount(1);
  await expect(page).toHaveURL(/\/account\/security$/);

  // The first removed on its own touch: this device's session goes with it, so the answer renders no page and the
  // browser leaves for the sign-in as a new document.
  const own = await pressBehindTheTouch(page, "/account/security", async () => {
    await rows().first().click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  });
  expect(own.touches, "the removal of this device's passkey asked no touch of its own").toBe(1);
  expect(own.headers["x-action-revalidated"], "the removal ending this device's session rendered a page again").toBeUndefined();
  expect(own.body, "the answer carries a render of Sicherheit").not.toContain("Alle anderen abmelden");
  await expect(page).toHaveURL((url) => url.pathname === "/signin");
  await expect(page.getByRole("heading", { name: "Anmelden" })).toBeVisible();
});

test("a passkey holder's address change and deletion each run behind the touch", async ({ page, context }) => {
  await signInWithCode(page, HOLDER);
  await expect(page).toHaveURL(/\/signin\/passkey/);
  await page.getByRole("button", { name: "Später" }).click();

  // A passkey again, set up on the code's fresh session, which nobody holding one asks no touch of.
  await context.credentials.install();
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(page.getByRole("button", { name: "Löschen" })).toHaveCount(1);

  // The change's start asks the touch before it posts, and stands as the pending change its box then shows.
  await page.goto("/account/signin");
  await page.getByLabel("Neue E-Mail-Adresse").fill(HOLDER.replace("@", ".neu@"));
  const started = await pressBehindTheTouch(page, "/account/signin", async () => {
    await page.getByRole("button", { name: "Link senden" }).click();
  });
  expect(started.touches, "the address change's start asked no touch").toBe(1);
  const withdraw = page.getByRole("button", { name: "Änderung zurückziehen" });
  await expect(withdraw).toBeVisible();
  await withdraw.click();
  await expect(page.getByRole("button", { name: "Link senden" })).toBeVisible();

  // The deletion's link, mailed from Konto, and its act behind the touch.
  const before = await filedMessages();
  await page.getByRole("button", { name: "Konto löschen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  const link = await mailedLink(HOLDER, "Konto löschen", before);
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Konto löschen" })).toBeVisible();
  const deleted = await pressBehindTheTouch(page, "/erasure", async () => {
    await page.getByRole("main").getByRole("button", { name: "Konto löschen" }).click();
  });
  expect(deleted.touches, "the deletion asked no touch").toBe(1);
  expect(deleted.headers["x-action-redirect"]).toMatch(/^\/erasure\/done/);
  await expect(page.getByRole("heading", { name: "Konto gelöscht" })).toBeVisible();
});
