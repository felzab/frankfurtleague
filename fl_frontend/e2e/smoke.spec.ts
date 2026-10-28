/**
 * E2E · the harness's own proof, under each project: a public page reads the made-up league
 * through the backend. `signin.spec.ts` beside it signs in.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";

test("a visitor reads the made-up league's Spielplan", async ({ page }) => {
  await page.goto("/dashboard/spielplan");

  // A club of the made-up league, read through the backend: the page holds the seed.
  await expect(page.getByText("Ahorn").first()).toBeVisible();
});
