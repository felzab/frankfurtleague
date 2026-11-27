/**
 * E2E · the landing and the season pages, where no lower tier sees the root slot's pop-up open over the landing, a
 * season page fail to render on the seed's real data, its running season, or the classic footer, a server component
 * awaiting the year, drop its sponsor's paid mark.
 */
import { expect } from "@playwright/test";

import { enteredDialog } from "../support/controls";
import { hydrated, test } from "../support/journey";
import { RUNNING } from "../support/madeUpLeague";

/** The landing's one heading, its tagline. */
const TAGLINE = "Frankfurts Abi-Jahrgänge spielen um den Titel";

/** A match's page of the running season, as the landing's card and the Spielplan link it, by its whole pathname. */
const MATCH = new RegExp(`^/saisons/${RUNNING}/spiele/[0-9a-f]{24}$`);

test("the landing's Spielplan leads to the season's Spielplan, and a landing match opens as the pop-up", async ({ page }) => {
  let ready = hydrated(page);
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: TAGLINE })).toBeVisible();
  await ready;

  // The hero's first act leads straight to the Spielplan of the season the site is on.
  await page.getByRole("main").getByRole("link", { name: "Spielplan", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === `/saisons/${RUNNING}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Spielplan" })).toBeVisible();

  ready = hydrated(page);
  await page.goto("/");
  await ready;

  // A match row of the season card opens the match as the pop-up over the landing, through the root slot.
  const row = page.getByRole("main").locator(`a[href^='/saisons/${RUNNING}/spiele/']`).first();
  await row.click();
  await expect(page).toHaveURL((url) => MATCH.test(url.pathname));
  const popup = await enteredDialog(page);
  // The landing stays beneath it, drawn: the open pop-up hides it from the accessibility tree alone, where a landing
  // Next keeps after leaving it is not drawn at all.
  await expect(
    page.getByRole("main", { includeHidden: true }).getByRole("heading", { level: 1, name: TAGLINE, includeHidden: true }),
  ).toBeVisible();

  // Back closes the pop-up and leaves the landing.
  await page.goBack();
  await expect(popup).toBeHidden();
  await expect(page).toHaveURL((url) => url.pathname === "/");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: TAGLINE })).toBeVisible();
});

test("the rail's four season pages and the sponsors page each stand under their own heading", async ({ page }) => {
  // `/saisons`, the address a link uses where it cannot know the season, sends the browser on to the season the site
  // is on in-stream.
  await page.goto("/saisons");
  await expect(page).toHaveURL((url) => url.pathname === `/saisons/${RUNNING}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Spielplan" })).toBeVisible();

  // The rail's entries in its order, each a link to the season's page of that name.
  for (const [label, address] of [
    ["K.-o.-Runde", `/saisons/${RUNNING}/ko-runde`],
    ["Tabelle", `/saisons/${RUNNING}/tabelle`],
    ["Teams", `/saisons/${RUNNING}/teams`],
    ["Spielplan", `/saisons/${RUNNING}`],
  ] as const) {
    await page.getByRole("navigation", { name: "Hauptmenü" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === address);
    await expect(page.getByRole("main").getByRole("heading", { level: 1, name: label })).toBeVisible();
  }

  // The sponsors page, reached from the classic footer's „Liga“ group.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Sponsoren", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/sponsors");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Sponsoren" })).toBeVisible();
});

// The harm: a paid link that loses `rel="sponsored"` reads to a search engine as an endorsement, and no reader sees it.
test("the footer marks its sponsor's link paid", async ({ page }) => {
  await page.goto("/");
  const sponsor = page.getByRole("contentinfo").getByRole("link", { name: "Stiftung Polytechnische Gesellschaft", exact: true });
  await expect(sponsor).toHaveAttribute("rel", /(^| )sponsored( |$)/);
});
