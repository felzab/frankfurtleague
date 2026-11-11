/**
 * E2E · the public pages on a phone, where no lower tier sees one scroll sideways: only a browser computes a layout.
 * Measured at the profile's width and at 360 px, as `./access.spec.ts` measures the lists' addresses.
 */
import { expect } from "@playwright/test";

import { scrollsSideways } from "../support/controls";
import { test } from "../support/journey";

/** Each public page of the seed's running season, and the title it is read by once drawn. */
const PAGES = [
  ["/", "Frankfurts Abi-Jahrgänge spielen um den Titel"],
  ["/saisons/2027", "Spielplan"],
  ["/saisons/2027/tabelle", "Tabelle"],
  ["/saisons/2027/ko-runde", "K.-o.-Runde"],
  ["/saisons/2027/teams", "Teams"],
] as const;

test("no public page scrolls sideways at a phone's width", async ({ page }) => {
  const profile = page.viewportSize();
  if (profile === null) throw new Error("the phone project's profile sets a viewport");

  for (const width of [profile.width, 360]) {
    await page.setViewportSize({ ...profile, width });
    for (const [address, title] of PAGES) {
      await page.goto(address);
      await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();

      expect(await scrollsSideways(page), `${address} scrolls sideways at ${String(width)} px`).toBe(false);
    }
  }
});
