/**
 * E2E · the administration's venue and match editors, where no lower tier sees a created venue missing from its list, a
 * kick-off's time segments go unsaved, or a long name push the page sideways. Desktop alone: the seeded match and the new
 * venue can each be written once.
 */
import { expect } from "@playwright/test";

import { save, saveBar, scrollsSideways, typeInto } from "../support/controls";
import { ADMINISTRATOR_STATE, test } from "../support/journey";

import type { Page } from "@playwright/test";

test.use({ storageState: ADMINISTRATOR_STATE });

/** The seed's longest venue name, which no width of the page may break. */
const LONG_NAME = "Bezirkssportanlage Frankfurt-Nieder-Eschbach Nord";

/** The venue this journey creates; the stack is seeded afresh for every run. */
const NEW_VENUE = "Sportplatz Ulmenring";

/**
 * The running season's match 6, today at 16:00 between Kastanie and Eiche, the only match today at its
 * venue and with its referee, so a later kick-off meets no clash (`scripts/ops/seed/seed.js`). It stands on
 * the group stage's second matchday, which the Spiele list is opened on by its address, so the journey edits
 * that match whatever matchday the list would open on by itself.
 */
const SAISON = "2027";
const MATCHDAY = "gruppenphase-2";
// The match card's link is named by all its words, the date and the plaques among them, as the Spielplan's is.
const PAIRING = /Kastanie.*Eiche/;

/** The match's id, read off its card on its matchday's tab of the season's Spiele list, whose link opens its editor. */
async function spielId(page: Page): Promise<string> {
  await page.goto(`/admin/saisons/${SAISON}/spiele?tab=${MATCHDAY}`);
  const href = await page.getByRole("main").getByRole("link", { name: PAIRING }).getAttribute("href");
  const id = new RegExp(`^/admin/saisons/${SAISON}/spiele/([0-9a-f]{24})$`).exec(href ?? "")?.[1];
  if (id === undefined) throw new Error(`no editor link for ${PAIRING} on the Spiele list's ${MATCHDAY} tab`);
  return id;
}

test("an administrator creates a venue over the Spielorte list, moves a match's kick-off in its editor and opens its matchday's", async ({
  page,
}) => {
  // --- Spielorte ---------------------------------------------------------------------------------

  await page.goto("/admin/spielorte");
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Spielorte" })).toBeVisible();

  // A long name wraps in its row and pushes nothing sideways, on desktop and at a phone's width.
  await expect(page.getByRole("main").getByRole("cell", { name: LONG_NAME })).toBeVisible();
  expect(await scrollsSideways(page), "the page or its list scrolls sideways on desktop").toBe(false);
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("main").getByRole("cell", { name: LONG_NAME })).toBeVisible();
  expect(await scrollsSideways(page), "the page or its list scrolls sideways at a phone's width").toBe(false);
  if (desktop !== null) await page.setViewportSize(desktop);

  await page.getByRole("button", { name: "Spielort anlegen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // By the label's start: a required field's label ends in its asterisk.
  await typeInto(dialog.getByRole("textbox", { name: /^Name/ }), NEW_VENUE);
  await typeInto(dialog.getByRole("textbox", { name: /^Straße/ }), "Ulmenring");
  await typeInto(dialog.getByRole("textbox", { name: /^Nr\./ }), "3");
  await typeInto(dialog.getByRole("textbox", { name: /^PLZ/ }), "60431");
  await typeInto(dialog.getByRole("textbox", { name: /^Mietpreis/ }), "35");
  await dialog.getByRole("button", { name: "Spielort anlegen" }).click();

  // The dialog closes once the venue is created, and the list behind it reads it at once.
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("main").getByRole("cell", { name: NEW_VENUE })).toBeVisible();

  // --- The match editor --------------------------------------------------------------------------

  const editor = `/admin/saisons/${SAISON}/spiele/${await spielId(page)}`;
  await page.goto(editor);
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Kastanie vs. Eiche" })).toBeVisible();

  // The kick-off's hour, then its minutes: the segmented field moves on by itself after two digits.
  const time = page.getByRole("group", { name: /^Uhrzeit/ });
  await time.getByRole("spinbutton").first().click();
  await page.keyboard.type("1830");
  await expect(saveBar(page).getByText("1 Änderung", { exact: true })).toBeVisible();
  await save(page);

  // Read back from the server: the match now kicks off at 18:30.
  await page.reload();
  await expect(time.getByRole("spinbutton").first()).toHaveText("18");
  await expect(time.getByRole("spinbutton").nth(1)).toHaveText("30");

  // --- The matchday editor -----------------------------------------------------------------------

  // The matchday's „Bearbeiten“ leads to an editor page of its own, named as its tab is, on its one read.
  await page.goto(`/admin/saisons/${SAISON}/spiele?tab=${MATCHDAY}`);
  await page.getByRole("main").getByRole("link", { name: "Bearbeiten", exact: true }).click();
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "2. Spieltag" })).toBeVisible();
  await expect(page.getByRole("group", { name: /^Beginn/ })).toBeVisible();
});
