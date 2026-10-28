/**
 * E2E · the Spielplan at its season's address, under each project: the matchday tabs, a match opened
 * as the pop-up over them, Back closing it onto the matchday it was opened from, and the match's own
 * page on a direct load. The made-up seed's running season is 2027: its first matchday is played, its
 * second is today, and its first match is Ahorn against Kastanie, 2:1.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";

test("a visitor opens a match from the Spielplan, and Back returns to the matchday it showed", async ({ page }) => {
  // Next prefetches a `<Link>`'s route, in production and once the link is in view, only after React has
  // hydrated it (https://nextjs.org/docs/app/getting-started/linking-and-navigating#hydration-not-completed),
  // as a request carrying the `_rsc` search parameter, which a full document load of the same address never
  // does. The match rows are such links, so a prefetch of one is the sign the page is hydrated, and the
  // presses below are client navigations, which the pop-up's route intercepts, not full loads. Listening
  // from before the first load, the prefetch cannot be missed.
  const prefetched = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return /^\/saisons\/2027\/spiele\/[0-9a-f]{24}$/.test(url.pathname) && url.searchParams.has("_rsc");
  });
  await page.goto("/saisons/2027");

  // The tabs open on the current matchday, the first holding a match still to play.
  const tabs = page.getByRole("tablist", { name: "Spieltage" });
  await expect(tabs.getByRole("tab", { name: "2. Spieltag" })).toHaveAttribute("aria-selected", "true");
  await prefetched;

  // A tab is a link to the Spielplan at that matchday, so the address keeps the matchday chosen.
  const first = tabs.getByRole("tab", { name: "1. Spieltag" });
  await first.click();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL(/\/saisons\/2027\?tab=[^&]+$/);

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
  await expect(page).toHaveURL(/\/saisons\/2027\?tab=[^&]+$/);
  await expect(first).toHaveAttribute("aria-selected", "true");

  // Loaded directly, the same address is the match's own page, with no pop-up.
  await page.goto(matchPage);
  await expect(page.getByRole("heading", { level: 1, name: "Ahorn gegen Kastanie" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
