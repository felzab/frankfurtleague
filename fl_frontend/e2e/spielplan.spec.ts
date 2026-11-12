/**
 * E2E · the Spielplan, under each project, where no lower tier sees a match open as a page of its own rather than the
 * pop-up over the matchday, Back lose the matchday it was opened from, or a direct load of the match draw the pop-up.
 */
import { expect } from "@playwright/test";

import { hydrated, test } from "./support/journey";

test("a visitor opens a match from the Spielplan, and Back returns to the matchday it showed", async ({ page }) => {
  const prefetched = hydrated(page);
  await page.goto("/saisons/2027");

  // The tabs open on the current matchday, the first holding a match still to play: the seed's running season played its
  // first matchday, and its second is today.
  const tabs = page.getByRole("navigation", { name: "Spieltage" });
  await expect(tabs.getByRole("link", { name: "2. Spieltag" })).toHaveAttribute("aria-current", "page");
  await prefetched;

  // A tab is a link to the Spielplan at that matchday, so the address keeps the matchday chosen.
  const first = tabs.getByRole("link", { name: "1. Spieltag" });
  await first.click();
  await expect(first).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveURL((url) => url.pathname === "/saisons/2027" && url.searchParams.get("tab") === "gruppenphase-1");

  // A match row is a link to the match's page, which opens over the Spielplan. Only the chosen matchday's
  // matches are on the page, so the row's name finds it: the seed's first match, Ahorn against Kastanie, 2:1.
  await page.getByRole("link", { name: /Ahorn.*Kastanie/ }).click();
  const popup = page.getByRole("dialog", { name: "Ahorn vs. Kastanie" });
  await expect(popup).toBeVisible();
  await expect(popup.getByText("2:1")).toBeVisible();
  await expect(page).toHaveURL((url) => /^\/saisons\/2027\/spiele\/[0-9a-f]{24}$/.test(url.pathname));
  // The Spielplan stays beneath it, on the matchday it showed. The open pop-up hides everything outside
  // itself from the accessibility tree, which a role query skips unless told to include it.
  const beneath = page.getByRole("navigation", { name: "Spieltage", includeHidden: true });
  await expect(beneath).toBeVisible();
  await expect(beneath.getByRole("link", { name: "1. Spieltag", includeHidden: true })).toHaveAttribute("aria-current", "page");
  const matchPage = page.url();

  // Back closes the pop-up and leaves the Spielplan on the matchday it showed.
  await page.goBack();
  await expect(popup).toBeHidden();
  await expect(page).toHaveURL((url) => url.pathname === "/saisons/2027" && url.searchParams.get("tab") === "gruppenphase-1");
  await expect(first).toHaveAttribute("aria-current", "page");

  // Opened again, the pop-up's club name leads to the club's page. A client navigation leaves a parallel slot
  // showing its last page unless the new address matches one of its routes; the slot's catch-all matches the
  // club's page and draws no pop-up.
  await page.getByRole("link", { name: /Ahorn.*Kastanie/ }).click();
  await expect(popup).toBeVisible();
  await popup.getByRole("link", { name: "Ahorn", exact: true }).click();
  await expect(page).toHaveURL((url) => /^\/saisons\/2027\/teams\/[0-9a-f]{24}$/.test(url.pathname));
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Ahorn" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Loaded directly, the match's address is the match's own page, with no pop-up.
  await page.goto(matchPage);
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: "Ahorn vs. Kastanie" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
