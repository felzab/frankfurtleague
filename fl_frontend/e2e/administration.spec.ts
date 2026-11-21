/**
 * E2E · the administration's editors, under each project, where no lower tier sees a club editor's one save reach only
 * one of its two records, or a squad row's save get lost.
 */
import { expect } from "@playwright/test";

import { choose, enteredDialog, save, saveBar, typeInto } from "./support/controls";
import { ADMINISTRATOR_STATE, test } from "./support/journey";
import { PLANNED, RUNNING } from "./support/madeUpLeague";

test.use({ storageState: ADMINISTRATOR_STATE });

test("a known club enters the planned season, and its editor's one save reaches both its records", async ({
  page,
  entered: { team, colour },
}) => {
  const website = `https://${team.toLowerCase()}.example.com/`;

  await page.goto(`/admin/saisons/${PLANNED}/teams`);
  await page.getByRole("button", { name: "Team eintragen" }).click();
  const dialog = await enteredDialog(page, "Team eintragen");
  await choose(page, dialog, /^Team$/, team);
  await choose(page, dialog, /^Gruppe/, /^Gruppe C/);
  await dialog.getByRole("button", { name: "Eintragen" }).click();
  await expect(dialog).toBeHidden();

  // The club's own field and its season row's, in one press of the bar.
  await page.getByRole("main").getByRole("link", { name: team }).click();
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: team })).toBeVisible();
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

test("a pupil's squad row saves from its editor", async ({ page, kaderPupil }) => {
  await page.goto(`/admin/saisons/${RUNNING}/spieler`);
  await page.getByRole("main").getByRole("link", { name: kaderPupil }).click();
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: kaderPupil })).toBeVisible();

  const number = page.getByRole("main").getByRole("textbox", { name: /^Nummer/ });
  await typeInto(number, "23");
  await save(page);

  // Read back from the server.
  await page.reload();
  await expect(number).toHaveValue("23");
});
