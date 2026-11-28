/**
 * E2E · a club leaving mid-season, under each project, where no lower tier sees the opponent still to play it left
 * untold at the write. The scheduler tells the booked referee, in the first pass's journey.
 */
import { expect } from "@playwright/test";

import { enteredDialog, typeInto } from "./support/controls";
import { ADMINISTRATOR_STATE, test } from "./support/journey";
import { PEOPLE, RUNNING } from "./support/madeUpLeague";
import { filedMessages, mailedMessage } from "./support/mailSink";

test.use({ storageState: ADMINISTRATOR_STATE });

/** The Trainer of the one opponent holding a contact. */
const OPPONENT = PEOPLE.austritt.opponent.address;

test("a club leaves the season, and its opponent is told at once", async ({ page, departing: { team, fixture } }) => {
  await page.goto(`/admin/saisons/${RUNNING}/teams`);
  await page.getByRole("main").getByRole("link", { name: team }).click();
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: team })).toBeVisible();

  // The dialog opens on a withdrawal from today: the reason is what it cannot know.
  const before = await filedMessages();
  await page.getByRole("main").getByRole("button", { name: "Eintragen", exact: true }).click();
  const dialog = await enteredDialog(page, "Austritt eintragen");
  await typeInto(dialog.getByRole("textbox", { name: /^Grund/ }), "Das Team tritt nicht mehr an.");
  await dialog.getByRole("button", { name: "Eintragen", exact: true }).click();
  await expect(dialog).toBeHidden();

  // The club reads as gone, and no act on the page could bring it back.
  // The status chip in the title strip, beside the record's name, rather than the same word anywhere on the page.
  const strip = page.getByRole("main").locator("header", { has: page.getByRole("heading", { level: 1 }) });
  await expect(strip.getByText("Zurückgezogen", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Eintragen", exact: true })).toHaveCount(0);

  // The opponent's notice names the fixture still open between the two.
  const notice = await mailedMessage(OPPONENT, `Ausgeschieden: ${team}`, before);
  expect(notice.join("\n"), "the fixture the opponent is told of").toContain(fixture);
});
