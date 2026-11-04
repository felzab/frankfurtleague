/**
 * E2E · J8, a person's account acts, under each project: the address change through its two mailed links, the address
 * on file asked first, then the new mailbox; then the deletion through its mailed link, opened signed out and carried
 * through the sign-in, its action leading to the page that needs no session. Before them Konto's frame: the phone's
 * list of its four pages and the way back through it, the desktop's rail, Darstellung, and „Alle anderen abmelden“ with
 * a second device. Konto's steps are named by the board's words, which Konto's pages are built to. The passkeys are
 * `desktop/kontoPasskeys.spec.ts`'s.
 *
 * The person is the project's `leaver`, an address no other journey signs in as: the change moves their records and the
 * deletion erases them, which would break any journey after this one reading them.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";
import { filedMessages, mailedLink } from "./support/mailSink";
import { signInWithCode, signInWithCodeHere } from "./support/signIn";

import type { Page } from "@playwright/test";

// The change's new address is the deletion's account: the second journey runs on what the first left.
test.describe.configure({ mode: "serial" });

/** The project's leaver at a mailbox of their own the change moves them to. */
const newAddressOf = (leaver: string): string => leaver.replace("@", ".neu@");

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
  leaver,
  isMobile,
}) => {
  // A second device, signed in first through the journey's own visitor. Two of the address's five codes an hour, the
  // address change below the third.
  const other = await browser.newContext({ proxy, baseURL });
  const elsewhere = await other.newPage();
  await signIn(elsewhere, leaver);
  await signIn(page, leaver);

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

  // Darstellung acts at once, with the account menu's three glyphs.
  await page.goto("/account/appearance");
  await page.getByRole("main").getByRole("button", { name: "Dunkel" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("main").getByRole("button", { name: "Hell" }).click();
  await expect(page.locator("html")).not.toHaveClass(/dark/);

  // „Alle anderen abmelden“ asks first, then ends the other device's session and keeps this one.
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Alle anderen abmelden" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByText("Alle abgemeldet", { exact: true })).toBeVisible();
  await expect(page.getByText("Du bist auf 1 Gerät angemeldet.")).toBeVisible();
  await elsewhere.goto("/account/signin");
  await expect(elsewhere).toHaveURL(/\/signin/);
  await page.goto("/account/signin");
  await expect(page).toHaveURL(/\/account\/signin$/);
  await other.close();
});

test("a person changes their address: the address on file confirms first, then the new mailbox", async ({ page, context, leaver }) => {
  const newAddress = newAddressOf(leaver);
  await signIn(page, leaver);

  // Konto's address box: the new address, and the link it sends.
  await page.goto("/account/signin");
  const before = await filedMessages();
  await page.getByLabel("Neue E-Mail-Adresse").fill(newAddress);
  await page.getByRole("button", { name: "Link senden" }).click();

  // The address on file's link asks it first, naming the address the change goes to.
  const previousLink = await mailedLink(leaver, "Änderung der E-Mail-Adresse", before);
  await page.goto(previousLink);
  await expect(page.getByRole("heading", { name: "Änderung bestätigen" })).toBeVisible();
  await expect(page.getByText(newAddress, { exact: true })).toBeVisible();
  const afterTheFirst = await filedMessages();
  await page.getByRole("button", { name: "Bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Änderung bestätigt" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zum Konto" })).toBeVisible();

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
  await expect(page.getByRole("link", { name: "Anmelden" })).toBeVisible();
});

test("the person deletes their account from the mailed link, signed out when it opens", async ({ page, context, leaver }) => {
  const address = newAddressOf(leaver);
  await signIn(page, address);

  // Konto's deletion box mails the link; its dialog asks first.
  await page.goto("/account/signin");
  const before = await filedMessages();
  await page.getByRole("button", { name: "Konto löschen" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Konto löschen" }).click();
  const link = await mailedLink(address, "Konto löschen", before);

  // Opened signed out, the link leads through the sign-in and back to itself.
  await context.clearCookies();
  await page.goto(link);
  await expect(page.getByText("Du bist nicht angemeldet.")).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Anmelden" }).click();
  await expect(page).toHaveURL(/\/signin\?return=/);
  await signInWithCodeHere(page, address);
  // The passkey offer's „Später“ goes on to the address the link asked for, as the code's landing does.
  await expect(page).toHaveURL(/\/signin\/passkey\?return=/);
  await page.getByRole("button", { name: "Später" }).click();
  await expect(page).toHaveURL(/\/erasure\?token=/);

  // The list of what goes names the account's address.
  await expect(page.getByRole("heading", { name: "Konto löschen" })).toBeVisible();
  await expect(page.getByText(address, { exact: true })).toBeVisible();
  await expect(page.getByText("Alles oben wird endgültig gelöscht.")).toBeVisible();

  // The deletion ends the caller's own session, so the action's answer is the done page's render alone: the link's
  // page is never rendered again under a session that is gone.
  const answered = page.waitForResponse(
    async (response) => response.request().method() === "POST" && (await response.request().headerValue("next-action")) !== null,
  );
  await page.getByRole("button", { name: "Konto löschen" }).click();
  const response = await answered;
  expect(await response.headerValue("x-action-redirect")).toMatch(/^\/erasure\/done/);
  // The library's own deletion of the session's cookie reached the action's answer, which is what makes Next render a
  // page again at all, and what the redirect turns to the done page alone.
  expect(await response.headerValue("set-cookie"), "the action's answer deleted no session cookie").toMatch(/session_token=;[^,]*Max-Age=0/i);
  const body = await response.text();
  expect(body, "the action's answer renders the link's page again").not.toContain("Alles oben wird endgültig gelöscht.");
  expect(body, "the action's answer carries no render of the done page").toContain("Konto gelöscht");

  await expect(page).toHaveURL(/\/erasure\/done$/);
  await expect(page.getByRole("heading", { name: "Konto gelöscht" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Zur Startseite" })).toBeVisible();

  // The session is gone with the account: an area's page sends the browser to sign in.
  await page.goto("/area");
  await expect(page).toHaveURL(/\/signin/);
});
