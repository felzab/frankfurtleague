/**
 * E2E · J6's editors in the area, under each project, where no lower tier sees a club editor's one save reach only one
 * of its two records, a squad row's save get lost, or the season's Registrierungen fail on the seed's real rows.
 */
import { expect } from "@playwright/test";

import { SAISON as PLANNED } from "./support/application";
import { choose, save, saveBar, typeInto } from "./support/controls";
import { ADMINISTRATOR_STATE, test } from "./support/journey";

test.use({ storageState: ADMINISTRATOR_STATE });

/** The running season of the made-up seed, whose squads it fills. */
const RUNNING = "2027";

test("a known club enters the planned season, and its editor's one save reaches both its records", async ({
  page,
  entered: { club, colour },
}) => {
  const website = `https://${club.toLowerCase()}.example.com/`;

  await page.goto(`/admin/saisons/${PLANNED}/teams`);
  await page.getByRole("button", { name: "Team eintragen" }).click();
  const dialog = page.getByRole("dialog", { name: "Team eintragen" });
  await choose(page, dialog, /^Team$/, club);
  await choose(page, dialog, /^Gruppe/, /^Gruppe C/);
  await dialog.getByRole("button", { name: "Eintragen" }).click();
  await expect(dialog).toBeHidden();

  // The club's own field and its season row's, in one press of the bar.
  await page.getByRole("main").getByRole("link", { name: club }).click();
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: club })).toBeVisible();
  const main = page.getByRole("main");
  await typeInto(main.getByRole("textbox", { name: /^Website/ }), website);
  await choose(page, main, /Trikotfarbe/, colour);
  await expect(saveBar(page).getByText("2 Änderungen", { exact: true })).toBeVisible();
  await save(page);

  // Read back from the server: both halves stand.
  await page.reload();
  await expect(main.getByRole("textbox", { name: /^Website/ })).toHaveValue(website);
  await expect(main.getByRole("button", { name: /Trikotfarbe/ })).toContainText(colour);
});

test("a pupil's squad row saves from its editor, and the season's Registrierungen stand", async ({ page, squadded }) => {
  await page.goto(`/admin/saisons/${RUNNING}/spieler`);
  await page.getByRole("main").getByRole("link", { name: squadded }).click();
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: squadded })).toBeVisible();

  const number = page.getByRole("main").getByRole("textbox", { name: /^Nummer/ });
  await typeInto(number, "23");
  await save(page);

  // Read back from the server.
  await page.reload();
  await expect(number).toHaveValue("23");

  await page.goto(`/admin/saisons/${RUNNING}/registrierungen`);
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Registrierungen" })).toBeVisible();
  // The heading stands over an empty list too: a pupil's row of the seed is what says the list was read.
  await expect(page.getByRole("main").getByRole("link", { name: "Ole Sommer", exact: true })).toBeVisible();
});
