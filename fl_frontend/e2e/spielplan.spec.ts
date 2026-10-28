/**
 * E2E · the Spielplan at its season's address, under each project: the matchday tabs, a match opened
 * as the pop-up over them, Back closing it onto the matchday it was opened from, and the match's own
 * page on a direct load. The made-up seed's running season is 2027: its first matchday is played, its
 * second is today, and its first match is Ahorn against Kastanie, 2:1.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";

test("a visitor opens a match from the Spielplan, and Back returns to the matchday it showed", async ({ page }) => {
  await page.goto("/saisons/2027");

  // The tabs open on the current matchday, the first holding a match still to play.
  const tabs = page.getByRole("tablist", { name: "Spieltage" });
  await expect(tabs.getByRole("tab", { name: "2. Spieltag" })).toHaveAttribute("aria-selected", "true");

  await tabs.getByRole("tab", { name: "1. Spieltag" }).click();
  await expect(tabs.getByRole("tab", { name: "1. Spieltag" })).toHaveAttribute("aria-selected", "true");

  // A match row is a link to the match's page, which opens over the Spielplan.
  await page
    .getByRole("tabpanel")
    .getByRole("link", { name: /Ahorn.*Kastanie/ })
    .click();
  const popup = page.getByRole("dialog", { name: "Ahorn gegen Kastanie" });
  await expect(popup).toBeVisible();
  await expect(popup.getByText("2:1")).toBeVisible();
  await expect(page).toHaveURL(/\/saisons\/2027\/spiele\/[0-9a-f]{24}$/);
  const matchPage = page.url();

  // Back closes the pop-up and leaves the Spielplan on the matchday it showed.
  await page.goBack();
  await expect(popup).toBeHidden();
  await expect(page).toHaveURL(/\/saisons\/2027$/);
  await expect(tabs.getByRole("tab", { name: "1. Spieltag" })).toHaveAttribute("aria-selected", "true");

  // Loaded directly, the same address is the match's own page, with no pop-up.
  await page.goto(matchPage);
  await expect(page.getByRole("heading", { level: 1, name: "Ahorn gegen Kastanie" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
