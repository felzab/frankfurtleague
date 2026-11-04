/**
 * E2E · the landing and the public pages around it, under the desktop project: the hero's „Spielplan“ straight to
 * the season the site is on, a match of the season card opened as the pop-up over the landing and closed by Back,
 * `/saisons`'s redirect to the same season and from there the rail's four season pages, and the sponsors page under
 * its own heading. The made-up seed's running season is 2027.
 */
import { expect } from "@playwright/test";

import { hydrated, test } from "../support/journey";

/** The landing's one heading, its tagline. */
const TAGLINE = "Frankfurts Abi-Jahrgänge spielen um den Titel";

/** A match's page of the season `2027`, as the landing's card and the Spielplan link it, by its whole pathname. */
const MATCH = /^\/saisons\/2027\/spiele\/[0-9a-f]{24}$/;

test("the landing's Spielplan leads to the season's Spielplan, and a landing match opens as the pop-up", async ({ page }) => {
  let ready = hydrated(page);
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: TAGLINE })).toBeVisible();
  await ready;

  // The hero's first act leads straight to the Spielplan of the season the site is on.
  await page.getByRole("main").getByRole("link", { name: "Spielplan", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/saisons/2027");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Spielplan" })).toBeVisible();

  ready = hydrated(page);
  await page.goto("/");
  await ready;

  // A match row of the season card opens the match as the pop-up over the landing, through the root slot.
  const row = page.getByRole("main").locator("a[href^='/saisons/2027/spiele/']").first();
  await row.click();
  await expect(page).toHaveURL((url) => MATCH.test(url.pathname));
  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
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
  await expect(page).toHaveURL((url) => url.pathname === "/saisons/2027");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Spielplan" })).toBeVisible();

  // The rail's entries in its order, each a link to the season's page of that name.
  for (const [label, address] of [
    ["K.-o.-Runde", "/saisons/2027/ko-runde"],
    ["Tabelle", "/saisons/2027/tabelle"],
    ["Teams", "/saisons/2027/teams"],
    ["Spielplan", "/saisons/2027"],
  ] as const) {
    await page.getByRole("navigation", { name: "Navigation" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === address);
    await expect(page.getByRole("main").getByRole("heading", { level: 1, name: label })).toBeVisible();
  }

  // The sponsors page, reached from the classic footer's „Liga“ group.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Sponsoren", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/sponsors");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Sponsoren" })).toBeVisible();
});
