/**
 * E2E · the area on a phone: the four lists read under the shared administrator's session, an administrator's and no
 * owner's. Reads alone: every act here takes the passkey touch, which WebKit cannot answer, so the acts are desktop's.
 * Each reads rows the seed wrote and no journey changes.
 */
import { expect } from "@playwright/test";

import { chooseWho } from "../support/actionLog";
import { chip, enteredDialog } from "../support/controls";
import { ADMINISTRATOR_STATE, test } from "../support/journey";
import { FINISHED, PEOPLE } from "../support/madeUpLeague";

test.use({ storageState: ADMINISTRATOR_STATE });

// What the page's unit case reads only as the props it hands the kit: the owner's acts, which stand for every
// administrator locked with their reason so the page has one shape for every reader, as WebKit's page carries the lock
// to a reader, and a fold opening in WebKit, the one fold this project presses.
test("Administratoren opens what waits, and shows an administrator the owner's acts locked", async ({ page }) => {
  await page.goto("/admin/administrators");
  const main = page.getByRole("main");

  await main.getByRole("button", { name: /^Angekündigt/ }).click();
  await expect(main.getByRole("row").filter({ hasText: PEOPLE.administrators.waiting })).toBeVisible();

  await expect(page.getByRole("button", { name: "Administrator eintragen" })).toHaveAttribute("aria-disabled", "true");
});

test("Adressänderungen reads a person's running change, and a holder's for the owner alone", async ({ page }) => {
  await page.goto("/admin/address-changes");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Adressänderungen" })).toBeVisible();
  const rows = page.getByRole("main").getByRole("row");
  await expect(chip(rows.filter({ hasText: PEOPLE.access.changing.address }), "Neue offen")).toBeVisible();
  await expect(rows.filter({ hasText: PEOPLE.administrators.moving })).toHaveCount(0);
});

// An address is what tells these rows apart, and a touch cannot reach the `title` a cut one keeps. Measured here because
// only a browser computes a layout.
test("a list's row shows its whole address at a phone's width", async ({ page }) => {
  const profile = page.viewportSize();
  if (profile === null) throw new Error("the phone project's profile sets a viewport");

  for (const width of [profile.width, 360]) {
    await page.setViewportSize({ ...profile, width });
    for (const [list, address] of [
      ["/admin/address-changes", PEOPLE.access.changing.address],
      ["/admin/ban-list", PEOPLE.access.ban],
    ] as const) {
      await page.goto(list);
      const cell = page.getByRole("main").getByRole("row").filter({ hasText: address }).getByText(address, { exact: true });
      await expect(cell).toBeVisible();

      const isWhole = await cell.evaluate((words) => words.scrollWidth <= words.clientWidth);
      expect(isWhole, `${address} is cut on ${list} at ${String(width)} px`).toBe(true);
    }
  }
});

// One who is enough: „Wer“ offers every one the log holds and reads the chosen back to one value its read filters on,
// so another option walks the same path; the desktop's journeys choose an address and „Automatisch“.
test("the Protokoll's filter sheet narrows to one who", async ({ page }) => {
  const main = page.getByRole("main");
  const rows = main.getByRole("row");
  // A row of each kind of who the seed wrote, and the one the sheet chooses.
  const chosen = {
    option: "Kontaktperson",
    what: `Termin beantwortet · Saison ${FINISHED}`,
    who: `Kontaktperson · ${PEOPLE.access.loggedTeam}`,
  };
  const others = [
    `Administrator eingetragen · ${PEOPLE.administrators.waiting}`,
    `Spielbericht eingetragen · Saison ${FINISHED} · Spiel 1`,
    "Nach Frist gelöscht · Kontaktpersonen: 2",
    "Konto gelöscht",
  ];

  await page.goto("/admin/log");
  // Each other row stands before the filter, so its absence after it is the filter's work and no wording's.
  for (const other of others) await expect(rows.filter({ hasText: other }).first()).toBeVisible();
  await main.getByRole("button", { name: "Filter" }).click();
  // A phone's selects stand in a sheet, which stays open over the list until „Fertig“.
  const sheet = await enteredDialog(page, "Filter");
  await chooseWho(page, sheet, chosen.option);
  await sheet.getByRole("button", { name: "Fertig" }).click();
  await expect(sheet).toBeHidden();

  await expect(rows.filter({ hasText: chosen.what }).filter({ hasText: chosen.who }).first()).toBeVisible();

  // Every other who's row is left out: unfiltered, the page would hold them all among its newest 50.
  for (const other of others) await expect(rows.filter({ hasText: other })).toHaveCount(0);
});
