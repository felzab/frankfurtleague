/**
 * E2E · the landing and the public pages around it, under the desktop project: the hero's „Spielplan“ straight to
 * the season the site is on, a match of the season card opened as the pop-up over the landing and closed by Back,
 * `/saisons`'s redirect to the same season and from there the rail's four season pages, the sponsors page under its
 * own heading, and an address no page answers any more meeting the not-found page. The made-up seed's running season
 * is 2027.
 */
import { expect } from "@playwright/test";

import { hydrated, test } from "../support/journey";

/** The landing's one heading, its tagline. */
const TAGLINE = "Frankfurts Abi-Jahrgänge spielen um den Titel";

/** A match link of the season `2027`, as the landing's card and the Spielplan write it, tested against the whole URL. */
const MATCH = /\/saisons\/2027\/spiele\/[0-9a-f]{24}$/;

test("the landing's Spielplan leads to the season's Spielplan, and a landing match opens as the pop-up", async ({ page }) => {
  let ready = hydrated(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: TAGLINE })).toBeVisible();
  await ready;

  // The hero's first act leads straight to the Spielplan of the season the site is on.
  await page.getByRole("main").getByRole("link", { name: "Spielplan", exact: true }).click();
  await expect(page).toHaveURL(/\/saisons\/2027$/);
  await expect(page.getByRole("heading", { level: 1, name: "Spielplan" })).toBeVisible();

  ready = hydrated(page);
  await page.goto("/");
  await ready;

  // A match row of the season card opens the match as the pop-up over the landing, through the root slot.
  const row = page.getByRole("main").locator("a[href^='/saisons/2027/spiele/']").first();
  await row.click();
  await expect(page).toHaveURL(MATCH);
  const popup = page.getByRole("dialog");
  await expect(popup).toBeVisible();
  // The landing stays beneath it; the open pop-up hides it from the accessibility tree.
  await expect(page.getByRole("heading", { level: 1, name: TAGLINE, includeHidden: true })).toBeAttached();

  // Back closes the pop-up and leaves the landing.
  await page.goBack();
  await expect(popup).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1, name: TAGLINE })).toBeVisible();
});

test("the rail's four season pages and the sponsors page each stand under their own heading", async ({ page }) => {
  // `/saisons`, the address a link uses where it cannot know the season, sends the browser on to the season the site
  // is on in-stream.
  await page.goto("/saisons");
  await expect(page).toHaveURL(/\/saisons\/2027$/);
  await expect(page.getByRole("heading", { level: 1, name: "Spielplan" })).toBeVisible();

  // The rail's entries in its order, each a link to the season's page of that name.
  for (const [label, address] of [
    ["K.-o.-Runde", /\/saisons\/2027\/ko-runde$/],
    ["Tabelle", /\/saisons\/2027\/tabelle$/],
    ["Teams", /\/saisons\/2027\/teams$/],
    ["Spielplan", /\/saisons\/2027$/],
  ] as const) {
    await page.getByRole("navigation", { name: "Navigation" }).getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(address);
    await expect(page.getByRole("heading", { level: 1, name: label })).toBeVisible();
  }

  // The sponsors page, reached from the classic footer's „Liga“ group.
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("link", { name: "Sponsoren", exact: true }).click();
  await expect(page).toHaveURL(/\/sponsors$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sponsoren" })).toBeVisible();
});

test("an address no page answers any more meets the not-found page", async ({ page }) => {
  // The old dashboard's address, which the rebuilt season pages replace.
  const response = await page.goto("/dashboard");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "Seite nicht gefunden" })).toBeVisible();
});
