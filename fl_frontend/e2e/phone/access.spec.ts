/**
 * E2E · the area on a phone: the five lists read under the session `../support/administrator.setup.ts` saved, an
 * administrator's and no owner's. Reads alone: every act here takes the passkey touch, which WebKit cannot answer, so
 * the acts are `../desktop/`'s. Each reads rows the seed wrote and no journey changes (`scripts/ops/seed/seed.js`).
 */
import { expect } from "@playwright/test";

import { chooseWho } from "../support/actionLog";
import { chip } from "../support/controls";
import { ADMINISTRATOR_STATE, test } from "../support/journey";

test.use({ storageState: ADMINISTRATOR_STATE });

test("Administratoren reads who holds access and what waits, and shows an administrator the owner's acts locked", async ({ page }) => {
  await page.goto("/admin/administrators");
  const main = page.getByRole("main");
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Administratoren" })).toBeVisible();

  const owner = main.getByRole("row").filter({ hasText: "inhaber@example.com" });
  await expect(chip(owner, "Leitung")).toBeVisible();

  await main.getByRole("button", { name: /^Angekündigt/ }).click();
  await expect(main.getByRole("row").filter({ hasText: "admin.wartet@example.com" }).filter({ hasText: "Neuer Administrator" })).toBeVisible();

  // The owner's acts stand for every administrator, locked with their reason, so the page has one shape for every reader.
  await expect(page.getByRole("button", { name: "Administrator eintragen" })).toHaveAttribute("aria-disabled", "true");
});

test("Löschungen opens on its one form", async ({ page }) => {
  await page.goto("/admin/erasures");
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Löschungen" })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("textbox", { name: /^Referenz der Anfrage/ })).toBeVisible();
  await expect(main.getByRole("button", { name: "Löschen" })).toBeVisible();
});

test("Adressänderungen reads a person's running change, and a holder's for the owner alone", async ({ page }) => {
  await page.goto("/admin/address-changes");
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Adressänderungen" })).toBeVisible();
  const rows = page.getByRole("main").getByRole("row");
  await expect(chip(rows.filter({ hasText: "nina.noll@example.com" }), "Neue offen")).toBeVisible();
  await expect(rows.filter({ hasText: "admin.umzug@example.com" })).toHaveCount(0);
});

// An address is what tells these rows apart, and a touch cannot reach the `title` a cut one keeps. Measured here because
// only a browser computes a layout.
test("a list's row shows its whole address at a phone's width", async ({ page }) => {
  const profile = page.viewportSize();
  if (profile === null) throw new Error("the phone project's profile sets a viewport");

  for (const width of [profile.width, 360]) {
    await page.setViewportSize({ ...profile, width });
    for (const [list, address] of [
      ["/admin/address-changes", "nina.noll@example.com"],
      ["/admin/ban-list", "gesperrte.person.mit.langer.adresse@example.com"],
    ] as const) {
      await page.goto(list);
      const cell = page.getByRole("main").getByRole("row").filter({ hasText: address }).getByText(address, { exact: true });
      await expect(cell).toBeVisible();

      const isWhole = await cell.evaluate((words) => words.scrollWidth <= words.clientWidth);
      expect(isWhole, `${address} is cut on ${list} at ${String(width)} px`).toBe(true);
    }
  }
});

// One who is enough: „Wer“ offers every one the log holds and reads the chosen back to one value its read filters on
// (`fl_frontend/src/features/action-log/filters.ts :: byOf`), so another option walks the same path; the desktop's
// journeys choose an address and „Automatisch“.
test("the Protokoll's filter sheet narrows to one who", async ({ page }) => {
  const main = page.getByRole("main");
  const rows = main.getByRole("row");
  // A row of each kind of who the seed wrote, and the one the sheet chooses.
  const chosen = { option: "Teams", what: "Termin beantwortet · 2026", who: "Kontaktperson · Birke" };
  const others = [
    "Administrator eingetragen · admin.wartet@example.com",
    "Spielbericht eingetragen · 2026 / 1",
    "Nach Frist gelöscht · Kontaktpersonen: 2",
    "Konto gelöscht",
  ];

  await page.goto("/admin/log");
  await main.getByRole("button", { name: "Filter" }).click();
  // A phone's selects stand in a sheet, which stays open over the list until „Fertig“.
  const sheet = page.getByRole("dialog", { name: "Filter" });
  // It takes the focus once it has risen. Playwright retries a press on a moving button behind a `scrollIntoView`, which
  // carries the sheet back down its scroller and the page under it, and React Aria closes a sheet the viewport has lost.
  await expect(sheet).toBeFocused();
  await chooseWho(page, sheet, chosen.option);
  await sheet.getByRole("button", { name: "Fertig" }).click();
  await expect(sheet).toBeHidden();

  await expect(rows.filter({ hasText: chosen.what }).filter({ hasText: chosen.who }).first()).toBeVisible();

  // Every other who's row is left out: unfiltered, the page would hold them all among its newest 50.
  for (const other of others) await expect(rows.filter({ hasText: other })).toHaveCount(0);
});
