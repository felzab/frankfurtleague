/**
 * E2E · an editor's save made after the session is gone: the proxy lets the server action through to its lane's
 * guard, and Next's action client reads the guard's answer onto the form, which keeps what was typed.
 */
import { expect } from "@playwright/test";

import { saveBar, typeInto } from "../support/controls";
import { test } from "../support/journey";
import { PEOPLE } from "../support/madeUpLeague";
import { enrolPasskey, signInWithCode } from "../support/signIn";

/** The administrator this journey alone signs in as. */
const EDITOR = PEOPLE.administrators.editor;

/** A venue's own editor, by its pathname. */
const EDITOR_PATH = /^\/admin\/spielorte\/[0-9a-f]{24}$/;

test("a save the proxy finds signed out stays on the form, saying the sign-in has ended", async ({ page, context }) => {
  await signInWithCode(page, EDITOR);
  await enrolPasskey(page, context);

  // The list's row is one link to the venue's editor, a plain table the server draws.
  await page.goto("/admin/spielorte");
  await page.getByRole("link", { name: PEOPLE.venues.edited }).click();
  await expect(page).toHaveURL((url) => EDITOR_PATH.test(url.pathname));
  const rent = page.getByRole("textbox", { name: "Mietpreis" });
  await expect(rent).toBeVisible();

  // The browser forgets the session while the editor stands open, as an expired one leaves it.
  await context.clearCookies();

  // Typed as a person types, which hydrates the page under the press, so the bar's save below finds its handler.
  await typeInto(rent, "45");
  // Still the editor: nothing but the save below may be what meets the proxy signed out.
  await expect(page).toHaveURL((url) => EDITOR_PATH.test(url.pathname));
  // Pressed alone, not by `save`: this save ends on the guard's refusal, never on the bar's „Gespeichert“.
  const bar = saveBar(page);
  await bar.getByRole("button", { name: "Speichern" }).click();

  // The answer itself is what is waited on: no navigation follows the press, so a URL would match before it.
  await expect(bar.getByText("Deine Anmeldung ist abgelaufen.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => EDITOR_PATH.test(url.pathname));
  await expect(rent).toHaveValue("45");
});
