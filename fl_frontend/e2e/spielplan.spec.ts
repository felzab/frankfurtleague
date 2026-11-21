/**
 * E2E · the Spielplan, under each project, where no lower tier sees a match open as a page of its own rather than the
 * pop-up over the matchday, Back lose the matchday it was opened from, or a direct load of the match draw the pop-up.
 */
import { expect } from "@playwright/test";

import { enteredDialog, expectNoDialog } from "./support/controls";
import { hydrated, test } from "./support/journey";
import { PEOPLE, RUNNING } from "./support/madeUpLeague";

/** The seed's first match, played, which the first matchday's tab lists. */
const OPENED = PEOPLE.spielplan.opened;
const [HOME] = OPENED.split(" vs. ");
// The match row's link is named by all its words, so the pairing finds it between them.
const ROW = new RegExp(OPENED.replace(" vs. ", ".*"));

test("a visitor opens a match from the Spielplan, and Back returns to the matchday it showed", async ({ page }) => {
  const prefetched = hydrated(page);
  await page.goto(`/saisons/${RUNNING}`);

  // The tabs open on the current matchday, the first holding a match still to play: the seed's running season played its
  // first matchday, and its second is today.
  const tabs = page.getByRole("navigation", { name: "Spieltage" });
  await expect(tabs.getByRole("link", { name: "2. Spieltag" })).toHaveAttribute("aria-current", "page");
  await prefetched;

  // A tab is a link to the Spielplan at that matchday, so the address keeps the matchday chosen.
  const first = tabs.getByRole("link", { name: "1. Spieltag" });
  await first.click();
  await expect(first).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL((url) => url.pathname === `/saisons/${RUNNING}` && url.searchParams.get("tab") === "gruppenphase-1");

  // A match row is a link to the match's page, which opens over the Spielplan. Only the chosen matchday's
  // matches are on the page, so the row's name finds it.
  await page.getByRole("link", { name: ROW }).click();
  const popup = await enteredDialog(page, OPENED);
  await expect(popup.getByText(PEOPLE.spielplan.ergebnis)).toBeVisible();
  await expect(page).toHaveURL((url) => new RegExp(`^/saisons/${RUNNING}/spiele/[0-9a-f]{24}$`).test(url.pathname));
  // The Spielplan stays beneath it, on the matchday it showed. The open pop-up hides everything outside
  // itself from the accessibility tree, which a role query skips unless told to include it.
  const beneath = page.getByRole("navigation", { name: "Spieltage", includeHidden: true });
  await expect(beneath).toBeVisible();
  await expect(beneath.getByRole("link", { name: "1. Spieltag", includeHidden: true })).toHaveAttribute("aria-current", "page");
  const matchPage = page.url();

  // Back closes the pop-up and leaves the Spielplan on the matchday it showed.
  await page.goBack();
  await expect(popup).toBeHidden();
  await expect(page).toHaveURL((url) => url.pathname === `/saisons/${RUNNING}` && url.searchParams.get("tab") === "gruppenphase-1");
  await expect(first).toHaveAttribute("aria-current", "page");

  // Opened again, the pop-up's club name leads to the club's page. A client navigation leaves a parallel slot
  // showing its last page unless the new address matches one of its routes; the slot's catch-all matches the
  // club's page and draws no pop-up.
  await page.getByRole("link", { name: ROW }).click();
  await (await enteredDialog(page, OPENED)).getByRole("link", { name: HOME, exact: true }).click();
  await expect(page).toHaveURL((url) => new RegExp(`^/saisons/${RUNNING}/teams/[0-9a-f]{24}$`).test(url.pathname));
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: HOME })).toBeVisible();
  await expectNoDialog(page);

  // Loaded directly, the match's address is the match's own page, with no pop-up.
  await page.goto(matchPage);
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: OPENED })).toBeVisible();
  await expectNoDialog(page);
});
