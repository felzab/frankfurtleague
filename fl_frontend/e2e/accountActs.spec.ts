/**
 * E2E · J8, a person's account acts, under each project: the address change through its two mailed links, the address
 * on file asked first, then the new mailbox; then the deletion through its mailed link, opened signed out and carried
 * through the sign-in, its action leading to the page that needs no session. Before them Konto's frame: the phone's
 * list of its four pages and the way back through it, the desktop's rail, Darstellung, and „Alle anderen abmelden“ with
 * a second device. Konto's steps are named by the board's words, which Konto's pages are built to. The passkeys are
 * `desktop/kontoPasskeys.spec.ts`'s.
 *
 * Each journey signs in as a person of its own, the project's `twoDevices`, `mover` and `leaver`, whom no other journey
 * signs in as: each writes what another would read, the sessions it ends, the records it moves, the account it erases.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";
import { filedMessages, mailedLink } from "./support/mailSink";
import { sessionCookies, signInWithCode, signInWithCodeHere } from "./support/signIn";

import type { Page } from "@playwright/test";

/** A code-borne sign-in past the passkey offer, which this journey leaves for later. */
async function signIn(page: Page, address: string): Promise<void> {
  await signInWithCode(page, address);
  await expect(page).toHaveURL(/\/signin\/passkey/);
  await page.getByRole("button", { name: "Später" }).click();
  await expect(page).toHaveURL(/\/area/);
}

test("Konto's frame, Darstellung and „Alle anderen abmelden“, on one sign-in and a second device's", async ({
  page,
  browser,
  proxy,
  baseURL,
  twoDevices,
  isMobile,
}) => {
  // A second device, signed in first through the journey's own visitor.
  const other = await browser.newContext({ proxy, baseURL });
  const elsewhere = await other.newPage();
  await signIn(elsewhere, twoDevices);
  await signIn(page, twoDevices);

  if (isMobile) {
    // A phone opens Konto on the list of its four pages, with no bottom bar: the band's „Zurück“ is the way out.
    await page.goto("/account");
    const list = page.getByRole("main").getByRole("navigation", { name: "Konto" });
    for (const name of ["Anmeldung", "Sicherheit", "Darstellung", "Deine Einträge"])
      await expect(list.getByRole("link", { name })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navigation" })).toHaveCount(0);
    await list.getByRole("link", { name: "Sicherheit" }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
    await page.getByRole("link", { name: "Zurück" }).click();
    await expect(page).toHaveURL(/\/account$/);
    await page.getByRole("link", { name: "Zurück" }).click();
    await expect(page).not.toHaveURL(/\/account/);
  } else {
    // A desktop's rail lists the four pages, „Zurück“ in its head leading out of Konto at once.
    await page.goto("/account/signin");
    const rail = page.getByRole("complementary").getByRole("navigation", { name: "Navigation" });
    for (const name of ["Anmeldung", "Sicherheit", "Darstellung", "Deine Einträge"])
      await expect(rail.getByRole("link", { name })).toBeVisible();
    await rail.getByRole("link", { name: "Sicherheit" }).click();
    await expect(page).toHaveURL(/\/account\/security$/);
    await page.getByRole("complementary").getByRole("link", { name: "Zurück" }).click();
    await expect(page).not.toHaveURL(/\/account/);
  }

  // Darstellung acts at once, with the account menu's three glyphs: one choice of three, so React Aria's single-select
  // button group draws them as radios, and next-themes marks the theme on the root's `data-theme`.
  await page.goto("/account/appearance");
  await page.getByRole("main").getByRole("radio", { name: "Dunkel" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("main").getByRole("radio", { name: "Hell" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // „Alle anderen abmelden“ asks first, then ends the other device's session and keeps this one.
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Alle anderen abmelden" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByText("Alle abgemeldet", { exact: true })).toBeVisible();
  await expect(page.getByText("Du bist auf 1 Gerät angemeldet.")).toBeVisible();
  // The page's own guard sends the ended session to the sign-in. Judged on the whole path, since `/account/signin`
  // itself ends in `/signin`.
  await elsewhere.goto("/account/signin");
  await expect(elsewhere).toHaveURL((url) => url.pathname === "/signin");
  expect(await sessionCookies(other, baseURL), "the other device still holds its ended session's cookie").toEqual([]);
  await page.goto("/account/signin");
  await expect(page).toHaveURL(/\/account\/signin$/);
  await other.close();
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
  await expect(page.getByRole("heading", { name: "Änderung bestätigen" })).toBeVisible();
  await expect(page.getByText(newAddress, { exact: true })).toBeVisible();
  const afterTheFirst = await filedMessages();
  await page.getByRole("button", { name: "Bestätigen" }).click();
  // The press's own end, by its sentence: the answer also renders the page again, and the link read again is in the
  // opened-again state, whose title and way on are the same.
  await expect(page.getByRole("heading", { name: "Änderung bestätigt" })).toBeVisible();
  await expect(page.getByText("Die neue Adresse bekommt jetzt ihren Link.")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Zum Konto" })).toBeVisible();

  // Opened again, the link says what was done and when, and asks nothing.
  await page.goto(previousLink);
  await expect(page.getByText(/^Änderung bestätigt am \d{1,2}\. \S+ \d{4}\.$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Bestätigen" })).toHaveCount(0);

  // Only now the new mailbox is asked; its confirmation makes the change take effect.
  const newLink = await mailedLink(newAddress, "Neue E-Mail-Adresse bestätigen", afterTheFirst);
  await context.clearCookies();
  await page.goto(newLink);
  await expect(page.getByRole("heading", { name: "E-Mail-Adresse bestätigen" })).toBeVisible();
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Adresse bestätigt" })).toBeVisible();
  await expect(page.getByText("Mit dieser Adresse meldest du dich ab jetzt an.")).toBeVisible();
  // In the page's own end: the classic header holds an „Anmelden“ of its own on a desktop.
  await expect(page.getByRole("main").getByRole("link", { name: "Anmelden" })).toBeVisible();
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
  await expect(page.getByText("Du bist nicht angemeldet.")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/signin\?return=/);
  await signInWithCodeHere(page, leaver);
  // The passkey offer's „Später“ goes on to the address the link asked for, as the code's landing does.
  await expect(page).toHaveURL(/\/signin\/passkey\?return=/);
  await page.getByRole("button", { name: "Später" }).click();
  await expect(page).toHaveURL(/\/erasure\?token=/);

  // The list of what goes names the account's address, as the value of its row. Asked by role: the sign-in's steps
  // stay in the document hidden, as Next keeps the routes a visitor came through, and they name the address too.
  await expect(page.getByRole("heading", { name: "Konto löschen" })).toBeVisible();
  await expect(page.getByRole("definition").filter({ hasText: leaver })).toHaveText(leaver);
  await expect(page.getByText("Alles oben wird endgültig gelöscht.")).toBeVisible();

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
});
