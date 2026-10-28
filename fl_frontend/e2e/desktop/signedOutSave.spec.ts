/**
 * E2E · an editor's save made after the session is gone: the proxy answers the server action with a
 * redirect to `/signin` (`fl_frontend/src/proxy.ts :: turnAway`), and Next's action client follows it.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { enrolPasskey, signInWithCode } from "../support/signIn";

/** The administrator this journey alone signs in as (`scripts/ops/seed/seed.js`). */
const EDITOR = "admin.editor@example.com";

/** A venue's own editor, whatever season the list's link carries along. */
const EDITOR_URL = /\/bereich\/admin\/spielorte\/[0-9a-f]{24}(?:\?|$)/;

test("a save the proxy finds signed out lands on the sign-in page", async ({ page, context }) => {
  await signInWithCode(page, EDITOR);
  await enrolPasskey(page, context);

  await page.goto("/bereich/admin/spielorte");
  await page.getByRole("link", { name: "Bearbeiten: Spielort Sporthalle Birkenallee" }).click();
  await expect(page).toHaveURL(EDITOR_URL);
  // By its role: the number field's two stepper buttons carry its label too.
  const rent = page.getByRole("textbox", { name: "Standard-Mietpreis" });
  await expect(rent).toBeVisible();

  // The browser forgets the session while the editor stands open, as an expired one leaves it.
  await context.clearCookies();

  // The rent, which raises no banner to confirm; Tab commits the number field's draft.
  await rent.fill("45");
  await rent.press("Tab");
  // Still the editor: nothing but the save below may be what meets the proxy signed out.
  await expect(page).toHaveURL(EDITOR_URL);
  await page.getByRole("button", { name: "Speichern" }).click();

  await expect(page).toHaveURL(/\/signin$/);
});
