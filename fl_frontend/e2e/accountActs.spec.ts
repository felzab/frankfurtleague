/**
 * E2E · J8, a person's account acts, under each project: the address change through its two mailed links, the address
 * on file asked first, then the new mailbox; then the deletion through its mailed link, opened signed out and carried
 * through the sign-in, its action leading to the page that needs no session. Before them „Alle anderen abmelden“ with a
 * second device, whose cookie no person would see still admitted. Konto's steps are named by the board's words, which
 * Konto's pages are built to. The passkeys are `desktop/accountPasskeys.spec.ts`'s.
 *
 * Each journey signs in as a person of its own, the project's `twoDevices`, `mover` and `leaver`, whom no other journey
 * signs in as: each writes what another would read, the sessions it ends, the records it moves, the account it erases.
 */
import { expect } from "@playwright/test";

import { test as journey } from "./support/journey";
import { filedMessages, mailedLink } from "./support/mailSink";
import { expectAccountPageOf, sessionCookies, signInWithCode, signInWithCodeHere } from "./support/signIn";

import type { Page } from "@playwright/test";

/** A code-borne sign-in past the passkey offer, which this journey leaves for later. */
async function signIn(page: Page, address: string): Promise<void> {
  await signInWithCode(page, address);
  await expect(page).toHaveURL((url) => url.pathname === "/signin/passkey");
  await page.getByRole("button", { name: "Später" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/area");
}

/**
 * A second device, a browser context beside the test's own, built and closed in a fixture as Playwright's guide builds
 * one for a second role (https://playwright.dev/docs/auth#testing-multiple-roles-with-pom-fixtures), so a journey that
 * fails closes it too. The project's `use` options reach it as they reach every context the test's browser makes
 * (https://playwright.dev/docs/test-use-options#explicit-context-creation-and-option-inheritance). The journey's proxy
 * is named all the same: a fixture is torn down before what it depends on, so this context closes before the proxy, and
 * the edge is read once both have.
 */
const test = journey.extend<{ secondDevice: Page }>({
  secondDevice: async ({ browser, proxy }, provide) => {
    const device = await browser.newContext({ proxy });
    await provide(await device.newPage());
    await device.close();
  },
});

test("„Alle anderen abmelden“ ends a second device's session and keeps this one", async ({ page, secondDevice, baseURL, twoDevices }) => {
  // A second device, signed in first through the journey's own visitor.
  await signIn(secondDevice, twoDevices);
  await signIn(page, twoDevices);

  // „Alle anderen abmelden“ asks first, then ends the other device's session and keeps this one.
  await page.goto("/account/security");
  // Both sessions alive before the press, so the press is seen ending one rather than finding one already gone.
  await expect(page.getByRole("main").getByText("Du bist auf 2 Geräten angemeldet.")).toBeVisible();
  await page.getByRole("button", { name: "Alle anderen abmelden" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Abmelden" }).click();
  // The press's end: the count names this device alone, where it named two before.
  await expect(page.getByRole("main").getByText("Du bist auf 1 Gerät angemeldet.")).toBeVisible();
  // The page's own guard sends the ended session to the sign-in. Judged on the whole path, since `/account/signin`
  // itself ends in `/signin`.
  await secondDevice.goto("/account/signin");
  await expect(secondDevice).toHaveURL((url) => url.pathname === "/signin");
  expect(await sessionCookies(secondDevice.context(), baseURL), "the other device still holds its ended session's cookie").toEqual([]);
  await page.goto("/account/signin");
  await expect(page).toHaveURL((url) => url.pathname === "/account/signin");
});

test("a person changes their address: the address on file confirms first, then the new mailbox", async ({ page, context, mover }) => {
  // A mailbox of their own the change moves them to.
  const newAddress = mover.replace("@", ".neu@");
  await signIn(page, mover);

  // Konto's address box: the new address, and the link it sends.
  await page.goto("/account/signin");
  const before = await filedMessages();
  const field = page.getByLabel("Neue E-Mail-Adresse");
  // Tapped first, as `e2e/support/signIn.ts :: sendFromHere` taps its field: a bare `fill` before WebKit has hydrated
  // the field leaves React's state empty, and the form refuses the press as a missing address.
  await field.click();
  await field.fill(newAddress);
  // The start's own end, before any mail is waited for: the box stands as the pending change, which a refusal never
  // shows.
  await page.getByRole("button", { name: "Link senden" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: "Änderung zurückziehen" })).toBeVisible();

  // The address on file's link asks it first, naming the address the change goes to.
  const previousLink = await mailedLink(mover, "Änderung der E-Mail-Adresse", before);
  await page.goto(previousLink);
  await expect(page.getByRole("main").getByRole("heading", { name: "Änderung bestätigen" })).toBeVisible();
  await expect(page.getByRole("main").getByText(newAddress, { exact: true })).toBeVisible();
  const afterTheFirst = await filedMessages();
  await page.getByRole("button", { name: "Bestätigen" }).click();
  // The press's own end, by its sentence: the answer also renders the page again, and the link read again is in the
  // opened-again state, whose title and way on are the same.
  await expect(page.getByRole("main").getByRole("heading", { name: "Änderung bestätigt" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Die neue Adresse bekommt jetzt ihren Link.")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Zum Konto" })).toBeVisible();

  // Only now the new mailbox is asked; its confirmation makes the change take effect.
  const newLink = await mailedLink(newAddress, "Neue E-Mail-Adresse bestätigen", afterTheFirst);
  await context.clearCookies();
  await page.goto(newLink);
  await expect(page.getByRole("main").getByRole("heading", { name: "E-Mail-Adresse bestätigen" })).toBeVisible();
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("main").getByRole("heading", { name: "Adresse bestätigt" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Mit dieser Adresse meldest du dich ab jetzt an.")).toBeVisible();
  // In the page's own end: the classic header holds an „Anmelden“ of its own on a desktop.
  const signInHere = page.getByRole("main").getByRole("link", { name: "Anmelden" });
  await expect(signInHere).toBeVisible();

  // The change took effect, which the done page's sentence states whatever the backend answered: the new address signs
  // in, and its account page names it.
  await signInHere.click();
  await expect(page).toHaveURL((url) => url.pathname === "/signin");
  await signInWithCodeHere(page, newAddress);
  await expect(page).toHaveURL((url) => url.pathname === "/signin/passkey");
  await page.getByRole("button", { name: "Später" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/area");
  await expectAccountPageOf(page, newAddress);
});

test("the person deletes their account from the mailed link, signed out when it opens", async ({ page, context, baseURL, leaver }) => {
  await signIn(page, leaver);

  // Konto's deletion box mails the link; its dialog asks first.
  await page.goto("/account/signin");
  const before = await filedMessages();
  await page.getByRole("button", { name: "Konto löschen" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Löschen" }).click();
  const link = await mailedLink(leaver, "Konto löschen", before);

  // Opened signed out, the link leads through the sign-in and back to itself.
  await context.clearCookies();
  await page.goto(link);
  await expect(page.getByRole("main").getByText("Du bist nicht angemeldet.")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Anmelden" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/signin" && url.searchParams.has("return"));
  await signInWithCodeHere(page, leaver);
  // The passkey offer's „Später“ goes on to the address the link asked for, as the code's landing does.
  await expect(page).toHaveURL((url) => url.pathname === "/signin/passkey" && url.searchParams.has("return"));
  await page.getByRole("button", { name: "Später" }).click();
  // The token rides in the page's cookie, never in an address the sign-in or its bot check could read.
  await expect(page).toHaveURL((url) => url.pathname === "/erasure" && url.search === "");

  // The list of what goes names the account's address, as the value of its row.
  const erasure = page.getByRole("main");
  await expect(erasure.getByRole("heading", { name: "Konto löschen" })).toBeVisible();
  await expect(erasure.getByRole("definition").filter({ hasText: leaver })).toHaveText(leaver);
  await expect(erasure.getByText("Alles oben wird endgültig gelöscht.")).toBeVisible();

  // The deletion leads to the page that needs no session.
  await page.getByRole("main").getByRole("button", { name: "Konto löschen" }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/erasure/done");
  await expect(page.getByRole("main").getByRole("heading", { name: "Konto gelöscht" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Zur Startseite" })).toBeVisible();

  // The session goes with the account: the browser holds its cookie no longer, and an area's page sends it to sign in.
  // A cookie left standing is nothing a person sees, so only this journey holds its expiry.
  expect(await sessionCookies(context, baseURL), "the deletion left the session's cookie in the browser").toEqual([]);
  await page.goto("/area");
  await expect(page).toHaveURL((url) => url.pathname === "/signin");

  // Opened again signed out, the spent link says it is dead rather than asking for a sign-in it would not repair.
  await page.goto(link);
  await expect(page.getByRole("main").getByRole("heading", { name: "Link nicht mehr gültig" })).toBeVisible();
});
