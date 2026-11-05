/**
 * E2E · an editor's save made after the session is gone: the proxy answers the server action with a
 * redirect to `/signin` (`fl_frontend/src/proxy.ts :: turnAway`), and Next's action client follows it.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { enrolPasskey, signInWithCode } from "../support/signIn";

/** The administrator this journey alone signs in as (`scripts/ops/seed/seed.js`). */
const EDITOR = "admin.editor@example.com";

/** A venue's own editor, by its pathname. */
const EDITOR_PATH = /^\/admin\/spielorte\/[0-9a-f]{24}$/;

test("a save the proxy finds signed out lands on the sign-in page", async ({ page, context }) => {
  await signInWithCode(page, EDITOR);
  await enrolPasskey(page, context);

  // The list's row is one link to the venue's editor, a plain table the server draws.
  await page.goto("/admin/spielorte");
  await page.getByRole("link", { name: "Sporthalle Birkenallee" }).click();
  await expect(page).toHaveURL((url) => EDITOR_PATH.test(url.pathname));
  const rent = page.getByRole("textbox", { name: "Mietpreis" });
  await expect(rent).toBeVisible();

  // The browser forgets the session while the editor stands open, as an expired one leaves it.
  await context.clearCookies();

  // Tapped first, as `pressSend` taps the address field: React hydrates what a press lands on during the press
  // itself, and a bare `fill` into a field not yet hydrated is lost (`../support/signIn.ts`).
  await rent.click();
  await rent.fill("45");
  // Still the editor: nothing but the save below may be what meets the proxy signed out.
  await expect(page).toHaveURL((url) => EDITOR_PATH.test(url.pathname));
  await page.getByRole("region", { name: "Speichern" }).getByRole("button", { name: "Speichern" }).click();

  await expect(page).toHaveURL((url) => url.pathname === "/signin");
});
