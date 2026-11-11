/**
 * E2E · a contact's team area, under each project, where no lower tier sees a date's answer, an admission or a line-up
 * lost between the page and the server, or the frame's menu on a phone fail to reach the team's pages.
 */
import { expect } from "@playwright/test";

import { box, labelOf, save, saveBar } from "./support/controls";
import { test } from "./support/journey";
import { declinePasskeyOffer, signInWithCode } from "./support/signIn";

import type { Locator, Page } from "@playwright/test";

/** The running season of the made-up seed, which every seat of the journeys holds. */
const RUNNING = "2027";

/** A lone seat's landing, its team's Übersicht, under the team's id, which the seed mints anew on every run. */
const TEAM_LANDING = new RegExp(`^/area/team/[0-9a-f]{24}/${RUNNING}$`);

/** How many the line-up names, and how many of them start: every place of the Startelf, and two on the bench. */
const NAMED = 13;
const STARTING = 11;

/** The page's title, which every rail page writes in its strip, and on a phone at the top of its content. */
const titleOf = (page: Page, name: string): Locator => page.getByRole("banner").getByRole("heading", { level: 1, name, exact: true });

/**
 * One of the team's pages through the frame's menu: the rail on a desktop; on a phone the bar under the page, or the
 * „Mehr“ sheet for a page the bar has no place for.
 */
async function openPage(page: Page, name: string): Promise<void> {
  // Each is a navigation landmark, and only the one the width shows is in the accessibility tree.
  const menu = page.getByRole("navigation");
  const entry = menu.getByRole("link", { name, exact: true });
  const more = menu.getByRole("button", { name: "Mehr", exact: true });
  await expect(entry.or(more).first()).toBeVisible();
  if (await entry.isVisible()) await entry.click();
  else {
    await more.click();
    await page.getByRole("dialog", { name: "Mehr" }).getByRole("link", { name, exact: true }).click();
  }
  await expect(titleOf(page, name)).toBeVisible();
}

/** The toast an act at once answers with, by its title. */
const toast = (page: Page, title: string): Locator => page.getByRole("alertdialog", { name: title });

test("a contact answers the date, admits the pupil and enters the line-up", async ({ page, contact: { address, fixture, pupil } }) => {
  await signInWithCode(page, address);
  // The seat is the person's one place, so the sign-in lands on its Übersicht.
  await declinePasskeyOffer(page, TEAM_LANDING);
  await expect(titleOf(page, "Übersicht")).toBeVisible();

  // The open work: the date to answer, the line-up it owes, and the registration waiting on the team.
  const termine = box(page, "Termine");
  const fixtureLink = page.getByRole("link", { name: fixture, exact: true });
  await expect(termine.getByRole("link", { name: fixture, exact: true })).toBeVisible();
  await expect(box(page, "Aufstellungen").getByRole("link", { name: fixture, exact: true })).toBeVisible();
  await expect(box(page, "Registrierungen").getByRole("link", { name: pupil, exact: true })).toBeVisible();

  // „Zusagen“ acts at once: its toast, and the answered date leaves the box. A card row carries no role, so the row is
  // the kit's marked one holding the fixture's link.
  const agree = termine.locator("[data-kit-row]").filter({ has: fixtureLink }).getByRole("button", { name: "Zusagen" });
  await agree.click();
  await expect(toast(page, "Zugesagt")).toBeVisible();
  await expect(termine.getByRole("link", { name: fixture, exact: true })).toHaveCount(0);

  // The registration's row opens its dialog, titled by the pupil's name, whose „Aufnehmen“ admits at once: its toast,
  // and the row leaves the list.
  await openPage(page, "Registrierungen");
  const registration = page.getByRole("main").getByRole("row").filter({ hasText: pupil });
  await registration.getByRole("button", { name: pupil, exact: true }).click();
  await page.getByRole("dialog", { name: pupil }).getByRole("button", { name: "Aufnehmen", exact: true }).click();
  await expect(toast(page, "Aufgenommen")).toBeVisible();
  await expect(registration).toHaveCount(0);

  // The pupil stands in the Kader, a nominee, since the registration window had closed.
  await openPage(page, "Kader");
  await expect(page.getByRole("main").getByRole("row").filter({ hasText: pupil })).toContainText("Nachnominiert");

  // The answered date leaves the line-up as the one thing the match still needs from the club. A match row's link is
  // named by everything it shows, its two clubs among it, as `spielplan.spec.ts` finds one.
  await openPage(page, "Spiele");
  const match = page.getByRole("main").getByRole("link", { name: new RegExp(fixture.replace(" vs. ", ".*")) });
  await expect(match).toContainText("Aufstellung fehlt");
  await match.click();
  await expect(titleOf(page, fixture)).toBeVisible();

  const main = page.getByRole("main");
  const lineUp = main.getByRole("table", { name: "Aufstellung" });
  const named = lineUp.getByRole("checkbox");
  const rest = main.getByRole("table", { name: "Nicht aufgestellt" });
  // The squad's first pupils by shirt number, each moving up into the named list before the next is pressed: a press
  // landing before the move would name the same pupil twice.
  for (let count = 1; count <= NAMED; count++) {
    await rest.getByRole("button", { name: "Aufstellen" }).first().click();
    await expect(named).toHaveCount(count);
  }
  // Each tick on its label, one label to a named pupil's row.
  for (let index = 0; index < STARTING; index++) {
    await labelOf(lineUp, "checkbox").nth(index).click();
    await expect(named.nth(index)).toBeChecked();
  }

  const bar = saveBar(page);
  await expect(bar.getByText("Startelf 11 von 11", { exact: true })).toBeVisible();
  await save(page);

  // Read back from the server: everyone named, the Startelf ticked.
  await page.reload();
  await expect(named).toHaveCount(NAMED);
  await expect(lineUp.getByRole("checkbox", { checked: true })).toHaveCount(STARTING);
  await expect(bar.getByText("Startelf 11 von 11", { exact: true })).toBeVisible();
});
