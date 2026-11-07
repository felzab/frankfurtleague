/**
 * E2E · J9, a banned person: an administrator bans a person who holds a passkey, behind the administrator's real touch.
 * The person is told by mail, their session ends, and their passkey meets the sign-in's one sentence, which an address
 * holding no record meets too, so nobody can probe the list. Desktop alone, both people holding a passkey, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { typeInto } from "../support/application";
import { test as journey } from "../support/journey";
import { filedMessages, mailedMessage } from "../support/mailSink";
import { assertionsSigned, enrolPasskey, failureLine, signInWithCode } from "../support/signIn";
import { standInForTurnstile } from "../support/turnstileStandIn";

import type { Page } from "@playwright/test";

/** The person this journey bans (`scripts/ops/seed/seed.js`), whom no other journey signs in as. */
const PERSON = "paula.paul@example.com";

/** The administrator who bans them, whom no other journey signs in as. */
const ADMINISTRATOR = "admin.sperre@example.com";

/** The administrator's device beside the person's, on the journey's proxy for the reason `../accountActs.spec.ts`'s second device is. */
const test = journey.extend<{ desk: Page }>({
  desk: async ({ browser, proxy }, provide) => {
    const device = await browser.newContext({ proxy });
    await standInForTurnstile(device);
    await provide(await device.newPage());
    await device.close();
  },
});

test("a banned person is told, loses their session and cannot sign in, by the sentence", async ({ page, context, desk }) => {
  // The person: an account, so the ban owes its mail, and a passkey, which outlives the session the ban ends.
  await signInWithCode(page, PERSON);
  await expect(page).toHaveURL((url) => url.pathname === "/signin/passkey");
  await page.getByRole("button", { name: "Später" }).click();
  await context.credentials.install();
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Passkey einrichten" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: "Löschen" })).toHaveCount(1);

  // The ban, behind the administrator's touch.
  await signInWithCode(desk, ADMINISTRATOR);
  await enrolPasskey(desk, desk.context());
  const touches = await assertionsSigned(desk.context());
  const before = await filedMessages();
  await desk.goto("/admin/ban-list");
  await desk.getByRole("button", { name: "Sperre eintragen" }).click();
  const dialog = desk.getByRole("dialog", { name: "Sperre eintragen" });
  await typeInto(dialog.getByRole("textbox", { name: /^E-Mail-Adresse/ }), PERSON);
  await typeInto(dialog.getByRole("textbox", { name: /^Grund/ }), "Beleidigungen am Spielfeldrand");
  await dialog.getByRole("button", { name: "Sperre eintragen" }).click();
  await expect(dialog).toBeHidden();
  const row = desk.getByRole("main").getByRole("row").filter({ hasText: PERSON });
  await expect(row).toBeVisible();

  await mailedMessage(PERSON, "Deine E-Mail-Adresse ist gesperrt", before);

  // The session went with the ban, and the passkey that outlives it meets the sentence.
  await page.goto("/account/signin");
  await expect(page).toHaveURL((url) => url.pathname === "/signin");
  await page.getByRole("button", { name: "Mit Passkey anmelden" }).click();
  await expect(failureLine(page).filter({ hasText: "Mit dieser Adresse ist keine Anmeldung möglich." })).toBeVisible();

  // Lifted from its row, behind a touch of its own.
  await row.getByRole("button", { name: "Entfernen" }).click();
  const question = desk.getByRole("alertdialog");
  await question.getByRole("button", { name: "Entfernen" }).click();
  await expect(question).toBeHidden();
  await expect(row).toHaveCount(0);
  expect(await assertionsSigned(desk.context()), "an act on the Sperrliste ran with no touch of its own").toBe(touches + 2);
});
