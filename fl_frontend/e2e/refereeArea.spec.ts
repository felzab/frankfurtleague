/**
 * E2E · a referee's area, under each project, where no lower tier sees a booking's answer or a match report's radio,
 * combo box or saved values lost between the page and the server.
 */
import { expect } from "@playwright/test";

import { box, comboOptions, labelOf, save, toast, typeInto, valueOf } from "./support/controls";
import { test } from "./support/journey";
import { RUNNING } from "./support/madeUpLeague";
import { expectLandedAt, signInWithCode } from "./support/signIn";

import type { Locator, Page } from "@playwright/test";

/**
 * A booking to answer in the Übersicht's „Termine“ card, by the link its name is: the row is the kit's, which holds its
 * acts beside the link and carries no role of its own.
 */
function bookingRow(page: Page, game: string): Locator {
  return box(page, "Termine")
    .locator("[data-kit-row]")
    .filter({ has: page.getByRole("link", { name: game, exact: true }) });
}

/**
 * A game's row under its matchday's head, each head a box of its own and the „Termine“ card's apart: the whole row a
 * link, named by everything it shows.
 */
function gameRow(page: Page, game: string): Locator {
  return page
    .getByRole("main")
    .locator("section")
    .filter({ hasNot: page.getByRole("heading", { name: "Termine", exact: true }) })
    .getByRole("link", { name: new RegExp(game.replace(" vs. ", ".*")) });
}

/**
 * Picks a pupil from a row's player list, as a person opens it from the keyboard, and returns the pick's words, which the
 * field shows once chosen. `Anonym`, a goal's first entry, is no pupil.
 */
async function pickPupil(page: Page, row: Locator): Promise<string> {
  await row.getByRole("combobox", { name: "Spieler" }).click();
  await page.keyboard.press("ArrowDown");
  const pupil = (await comboOptions(page)).filter({ hasNotText: "Anonym" }).first();
  const words = (await pupil.innerText()).trim();
  await pupil.click();
  return words;
}

test("a referee answers the coming game, saves the played game's report, and reads their fee in Konto", async ({
  page,
  booked: { address, played, coming },
}) => {
  await signInWithCode(page, address);
  // `/area/schiedsrichter` draws the Übersicht of the season the referee is booked in, at its own address.
  await expectLandedAt(page, "/area/schiedsrichter");

  // The coming game waits on the answer, given on its row in „Termine“: its toast, the booking leaves the card, and the
  // game's row under its matchday then says it.
  await expect(gameRow(page, coming)).toContainText("Antwort fehlt");
  await bookingRow(page, coming).getByRole("button", { name: "Zusagen", exact: true }).click();
  await expect(toast(page, "Zugesagt")).toBeVisible();
  await expect(bookingRow(page, coming)).toHaveCount(0);
  await expect(gameRow(page, coming)).toContainText("Zugesagt");

  // The played game owes its report, which its row opens.
  const playedRow = gameRow(page, played);
  await expect(playedRow).toContainText("Spielbericht fehlt");
  await playedRow.click();
  await expect(page).toHaveURL((url) => url.pathname.startsWith(`/area/schiedsrichter/${RUNNING}/spielbericht/`));
  await expect(page.getByRole("heading", { level: 1, name: played })).toBeVisible();

  // The second club of each project's played game fields a squad in the seed, so its pupils are there to pick.
  const [, side] = played.split(" vs. ");
  if (side === undefined) throw new Error(`the played game „${played}“ names no second club`);
  const main = page.getByRole("main");

  // A goal on its labelled row: the side, heard by its club's name whatever Kürzel it shows, the minute and the scorer.
  await main.getByRole("button", { name: "Tor eintragen" }).click();
  const goal = main.getByRole("group", { name: "Tor 1", exact: true });
  await labelOf(goal, "radio", side).click();
  await typeInto(goal.getByRole("textbox", { name: "Minute" }), "23");
  const scorer = await pickPupil(page, goal);

  // A card on its own: the side, the minute, the pupil and its colour.
  await main.getByRole("button", { name: "Karte eintragen" }).click();
  const card = main.getByRole("group", { name: "Karte 1", exact: true });
  await labelOf(card, "radio", side).click();
  await typeInto(card.getByRole("textbox", { name: "Minute" }), "40");
  const cautioned = await pickPupil(page, card);
  await labelOf(card, "radio", "Gelb").click();

  await save(page);

  // Read back from the server: both rows stand as entered.
  await page.reload();
  await expect(goal.getByRole("radio", { name: side, exact: true })).toBeChecked();
  await expect(goal.getByRole("textbox", { name: "Minute" })).toHaveValue("23");
  await expect(goal.getByRole("combobox", { name: "Spieler" })).toHaveValue(scorer);
  await expect(card.getByRole("radio", { name: side, exact: true })).toBeChecked();
  await expect(card.getByRole("textbox", { name: "Minute" })).toHaveValue("40");
  await expect(card.getByRole("combobox", { name: "Spieler" })).toHaveValue(cautioned);
  await expect(card.getByRole("radio", { name: "Gelb", exact: true })).toBeChecked();

  // The Übersicht's row says the report is in.
  await page.goto(`/area/schiedsrichter/${RUNNING}`);
  await expect(gameRow(page, played)).toContainText("Spielbericht eingetragen");

  // Konto's referee box holds the fee the league pays them.
  await page.goto("/account/entries");
  const entry = box(page, "Schiedsrichter");
  await expect(valueOf(entry, "Honorar")).toHaveText(/^\d+,\d{2}\s€$/);
});
