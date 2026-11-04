/**
 * E2E · J1, a visitor, under each project: the account pages a mail opens, in the classic frame. A link holding nothing,
 * mistyped or cut short, opens the status template's one message with its one way on. A deletion link opened signed
 * out is `accountActs.spec.ts`'s, which follows it through the sign-in and back.
 */
import { expect } from "@playwright/test";

import { test } from "./support/journey";

for (const link of ["/confirm/address?token=niemals-gemailt", "/confirm/address", "/erasure"]) {
  test(`${link}, holding nothing, says the link no longer holds`, async ({ page }) => {
    await page.goto(link);

    await expect(page.getByRole("heading", { name: "Link nicht mehr gültig" })).toBeVisible();
    await expect(page.getByText("Dieser Link gilt nicht mehr.")).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Zum Konto" })).toBeVisible();
    // The classic frame's own header, which every public page carries.
    await expect(page.getByRole("banner")).toBeVisible();
  });
}
