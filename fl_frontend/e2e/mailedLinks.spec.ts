/**
 * E2E · J1, a visitor, under each project: the account pages a mail opens, in the classic frame. A link holding nothing,
 * mistyped or cut short, opens the status template's one message with its one way on; a deletion link opened signed
 * out asks a sign-in that returns to it.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";

for (const link of ["/bestaetigung/adresse?token=niemals-gemailt", "/bestaetigung/adresse", "/loeschung"]) {
  test(`${link}, holding nothing, says the link no longer holds`, async ({ page }) => {
    await page.goto(link);

    await expect(page.getByRole("heading", { name: "Link nicht mehr gültig" })).toBeVisible();
    await expect(page.getByText("Dieser Link gilt nicht mehr.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Zum Konto" })).toBeVisible();
    // The classic frame's own header, which every public page carries.
    await expect(page.getByRole("banner")).toBeVisible();
  });
}

test("a deletion link opened signed out asks a sign-in that returns to the link", async ({ page }) => {
  await page.goto("/loeschung?token=niemals-gemailt");

  await expect(page.getByRole("heading", { name: "Konto löschen" })).toBeVisible();
  await expect(page.getByText("Du bist nicht angemeldet.")).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Anmelden" })).toHaveAttribute(
    "href",
    `/signin?${new URLSearchParams({ return: "/loeschung?token=niemals-gemailt" }).toString()}`,
  );
});
