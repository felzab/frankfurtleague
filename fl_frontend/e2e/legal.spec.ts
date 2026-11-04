/**
 * E2E · the two legal pages, under each project: the Impressum and the privacy notice reached from the classic
 * footer's „Rechtliches“ group, each under its own heading, the notice down to its retention table and its last
 * line, the day its words took effect.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";

test("the footer's legal group leads to the Impressum and to the privacy notice", async ({ page }) => {
  const legal = page.getByRole("contentinfo").getByRole("navigation", { name: "Rechtliches" });

  await page.goto("/");
  await legal.getByRole("link", { name: "Impressum", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/impressum");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Impressum" })).toBeVisible();

  await legal.getByRole("link", { name: "Datenschutz", exact: true }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/datenschutz");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Datenschutz" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("table", { name: "Speicherdauer" })).toBeVisible();
  await expect(page.getByRole("main").getByText(/^Stand: \d{1,2}\. \S+ \d{4}$/)).toBeVisible();
});
