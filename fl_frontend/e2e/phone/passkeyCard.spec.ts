/**
 * E2E · an administrator's mailed code on the phone, which leads to setting up a passkey and no
 * further. The ceremony itself runs in `desktop/passkey.spec.ts`, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { signInWithCode } from "../support/signIn";

test("an administrator's mailed code leads to setting up a passkey", async ({ page, administrator }) => {
  await signInWithCode(page, administrator);

  // The code alone does not open the Verwaltung: the card requires the passkey, where a person's
  // offers it with a way past.
  await expect(page).toHaveURL(/\/signin\/passkey$/);
  await expect(page.getByText("Die Verwaltung ist erst mit einem Passkey erreichbar.")).toBeVisible();
  await expect(page.getByText(administrator, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jetzt einrichten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Später" })).toHaveCount(0);

  // Asked for by its address, a Verwaltung page shows the session nothing: its read turns the session
  // to the sign-in's landing, which sends an administrator who owes a passkey back to this card.
  await page.goto("/bereich/verwaltung/spielorte");
  await expect(page).toHaveURL(/\/signin\/passkey$/);
  await expect(page.getByText("Die Verwaltung ist erst mit einem Passkey erreichbar.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Spielorte", exact: true })).toHaveCount(0);
});
