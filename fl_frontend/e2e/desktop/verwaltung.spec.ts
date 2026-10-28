/**
 * E2E · the administration's spike pages: an administrator creates a venue in the dialog over the
 * Spielorte list and finds it there, then moves a match's kick-off in the match editor and saves it.
 * One journey, one sign-in: an administrator's second sign-in would ask for the passkey the first set
 * up, which a new browser context does not hold. Desktop alone: the administration is desktop-first,
 * and the passkey it requires is desktop's (`fl_frontend/playwright.config.ts`).
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { enrolPasskey, signInWithCode } from "../support/signIn";

import type { Page } from "@playwright/test";

/** The administrator this journey alone signs in as (`scripts/ops/seed/seed.js`). */
const ADMINISTRATOR = "admin.verwaltung@example.com";

/** The seed's longest venue name, which no width of the page may break. */
const LONG_NAME = "Bezirkssportanlage Frankfurt-Nieder-Eschbach Nord";

/** The venue this journey creates; the stack is seeded afresh for every run. */
const NEW_VENUE = "Sportplatz Ulmenring";

/**
 * The running season's match 6, today at 16:00 between Kastanie and Eiche, the only match today at its
 * venue and with its referee, so a later kick-off meets no clash (`scripts/ops/seed/seed.js`).
 */
const SAISON = "2027";
const SPIEL_NR = 6;

/** Whether the document scrolls sideways, which no page may. */
const scrollsSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);

/**
 * The match's id, read off today's admin match search: no new page lists a season's matches yet, so the
 * old search's editor link names it.
 */
async function spielId(page: Page): Promise<string> {
  await page.goto(`/bereich/admin/spielsuche?saison_id=${SAISON}&status=heute`);
  const link = page.getByRole("link", { name: `Spiel bearbeiten: Spiel Nr. ${String(SPIEL_NR)}` });
  const href = await link.getAttribute("href");
  const id = /\/bereich\/admin\/spiele\/([0-9a-f]{24})/.exec(href ?? "")?.[1];
  if (id === undefined) throw new Error(`no editor link for match ${String(SPIEL_NR)} on today's search`);
  return id;
}

test("an administrator creates a venue over the Spielorte list, then moves a match's kick-off in its editor", async ({ page, context }) => {
  await signInWithCode(page, ADMINISTRATOR);
  await enrolPasskey(page, context);

  // --- Spielorte ---------------------------------------------------------------------------------

  await page.goto("/bereich/verwaltung/spielorte");
  await expect(page.getByRole("heading", { level: 1, name: "Spielorte" })).toBeVisible();

  // A long name stands in its row and pushes nothing sideways, on desktop and at a phone's width (D338).
  await expect(page.getByRole("cell", { name: LONG_NAME })).toBeVisible();
  expect(await scrollsSideways(page), "the list scrolls sideways on desktop").toBe(false);
  const desktop = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("cell", { name: LONG_NAME })).toBeVisible();
  expect(await scrollsSideways(page), "the list scrolls sideways at a phone's width").toBe(false);
  if (desktop !== null) await page.setViewportSize(desktop);

  await page.getByRole("button", { name: "Spielort anlegen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // By the label's start: a required field's label ends in its asterisk.
  await dialog.getByRole("textbox", { name: /^Name/ }).fill(NEW_VENUE);
  await dialog.getByRole("textbox", { name: /^Straße/ }).fill("Ulmenring");
  await dialog.getByRole("textbox", { name: /^Nr\./ }).fill("3");
  await dialog.getByRole("textbox", { name: /^PLZ/ }).fill("60431");
  await dialog.getByRole("textbox", { name: /^Mietpreis/ }).fill("35");
  await dialog.getByRole("button", { name: "Spielort anlegen" }).click();

  // The dialog closes once the venue is created, and the list behind it reads it at once.
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("cell", { name: NEW_VENUE })).toBeVisible();

  // The search narrows the list held on the page to the new venue.
  await page.getByRole("searchbox", { name: "Spielorte suchen" }).fill("Ulmen");
  await expect(page.getByRole("cell", { name: NEW_VENUE })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sporthalle Birkenallee" })).toBeHidden();

  // --- The match editor --------------------------------------------------------------------------

  const editor = `/bereich/verwaltung/saisons/${SAISON}/spiele/${await spielId(page)}`;
  await page.goto(editor);
  await expect(page.getByRole("heading", { level: 1, name: "Kastanie gegen Eiche" })).toBeVisible();

  // The kick-off's hour, then its minutes: the segmented field moves on by itself after two digits.
  const uhrzeit = page.getByRole("group", { name: /^Uhrzeit/ });
  await uhrzeit.getByRole("spinbutton").first().click();
  await page.keyboard.type("1830");
  await expect(page.getByText("1 Änderung", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Speichern" }).click();
  await expect(page.getByText("Gespeichert", { exact: true })).toBeVisible();

  // Read back from the server: the match now kicks off at 18:30.
  await page.reload();
  await expect(uhrzeit.getByRole("spinbutton").first()).toHaveText("18");
  await expect(uhrzeit.getByRole("spinbutton").nth(1)).toHaveText("30");
});
