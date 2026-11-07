/**
 * E2E · the area on a phone: the five lists read under the session `../support/administrator.setup.ts` saved, an
 * administrator's and no owner's. Reads alone: every act here takes the passkey touch, which WebKit cannot answer, so
 * the acts are `../desktop/`'s. Each reads rows the seed wrote and no journey changes (`scripts/ops/seed/seed.js`).
 */
import { expect } from "@playwright/test";

import { chooseWho } from "../support/actionLog";
import { ADMINISTRATOR_STATE, test } from "../support/journey";

test.use({ storageState: ADMINISTRATOR_STATE });

test("Administratoren reads who holds access and what waits, and offers an administrator no act", async ({ page }) => {
  await page.goto("/admin/administrators");
  const main = page.getByRole("main");
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Administratoren" })).toBeVisible();

  const owner = main.getByRole("row").filter({ hasText: "inhaber@example.com" });
  await expect(owner.getByText("Leitung", { exact: true })).toBeVisible();

  await main.getByRole("button", { name: /^Angekündigt/ }).click();
  await expect(main.getByRole("row").filter({ hasText: "admin.wartet@example.com" }).filter({ hasText: "Neuer Administrator" })).toBeVisible();

  // Over the whole page, the toolbar's acts drawn once the same read has answered.
  await expect(page.getByRole("button", { name: "Administrator eintragen" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Zurückziehen" })).toHaveCount(0);
});

test("the Sperrliste reads a ban", async ({ page }) => {
  await page.goto("/admin/ban-list");
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Sperrliste" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("row").filter({ hasText: "gesperrt@example.com" })).toBeVisible();
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
  await expect(rows.filter({ hasText: "nina.noll@example.com" }).getByText("Neue offen", { exact: true })).toBeVisible();
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
      ["/admin/ban-list", "gesperrt@example.com"],
    ] as const) {
      await page.goto(list);
      const cell = page.getByRole("main").getByRole("row").filter({ hasText: address }).getByText(address, { exact: true });
      await expect(cell).toBeVisible();

      const isWhole = await cell.evaluate((words) => words.scrollWidth <= words.clientWidth);
      expect(isWhole, `${address} is cut on ${list} at ${String(width)} px`).toBe(true);
    }
  }
});

test("the Protokoll narrows to each who", async ({ page }) => {
  const main = page.getByRole("main");
  const rows = main.getByRole("row");
  const seeded = [
    ["inhaber@example.com", "Administrator eingetragen · admin.wartet@example.com", "inhaber@example.com"],
    ["Teams", "Termin beantwortet · 2026", "Kontaktperson · Birke"],
    ["Schiedsrichter", "Spielbericht eingetragen · 2026 / 1", "Schiedsrichter"],
    ["Automatisch", "Nach Frist gelöscht · Kontaktpersonen: 2", "Automatisch"],
    ["Person", "Konto gelöscht", "Person"],
  ] as const;

  for (const [option, what, who] of seeded) {
    await page.goto("/admin/log");
    await main.getByRole("button", { name: "Filter" }).click();
    // A phone's selects stand in a sheet, which stays open over the list until „Fertig“.
    const sheet = page.getByRole("dialog", { name: "Filter" });
    await chooseWho(page, sheet, option);
    await sheet.getByRole("button", { name: "Fertig" }).click();
    await expect(sheet).toBeHidden();

    await expect(rows.filter({ hasText: what }).filter({ hasText: who }).first()).toBeVisible();

    // Every other who's row is left out: unfiltered, the page would hold them all among its newest 50.
    for (const [, other] of seeded.filter(([, seen]) => seen !== what)) await expect(rows.filter({ hasText: other })).toHaveCount(0);
  }
});
