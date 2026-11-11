/**
 * E2E · J6's part in the area: an administrator starts a change for a person who lost their mailbox and discards it,
 * erases an address on request, and reads each act back in the Protokoll, every act behind the administrator's real
 * touch. The touch asks the test's own context, so the journey signs in and sets up its passkey there: the session
 * `../support/administrator.setup.ts` saves carries cookies and no authenticator. Desktop alone, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects; `../phone/access.spec.ts` reads the lists on a phone.
 */
import { expect } from "@playwright/test";

import { chooseWho } from "../support/actionLog";
import { chip, pressRowAct, typeInto } from "../support/controls";
import { test } from "../support/journey";
import { filedMessages, mailedMessage } from "../support/mailSink";
import { assertionsSigned, enrolPasskey, signInWithCode } from "../support/signIn";

/** The administrator these acts are done by (`scripts/ops/seed/seed.js`), whom no other journey signs in as. */
const ADMINISTRATOR = "admin.zugang@example.com";

/** The person whose address the change starts on. */
const MOVER = "marta.moos@example.com";

/** The person this journey erases. */
const ERASED = "olga.ott@example.com";

/** The request's reference, the erasure's one word in the log. */
const REFERENCE = "Anfrage 17";

test("an administrator's acts on Adressänderungen and Löschungen take the touch and stand in the Protokoll", async ({ page, context }) => {
  await signInWithCode(page, ADMINISTRATOR);
  await enrolPasskey(page, context);
  const touches = await assertionsSigned(context);

  // --- Adressänderungen --------------------------------------------------------------------------

  const before = await filedMessages();
  const newAddress = MOVER.replace("@", ".neu@");
  await page.goto("/admin/address-changes");
  await page.getByRole("button", { name: "Änderung eintragen" }).click();
  const dialog = page.getByRole("dialog", { name: "Änderung eintragen" });
  await typeInto(dialog.getByRole("textbox", { name: /^Bisherige E-Mail-Adresse/ }), MOVER);
  await typeInto(dialog.getByRole("textbox", { name: /^Neue E-Mail-Adresse/ }), newAddress);
  await dialog.getByRole("button", { name: "Änderung eintragen" }).click();
  await expect(dialog).toBeHidden();

  // The row waits on the new mailbox, which its link reached.
  const row = page.getByRole("main").getByRole("row").filter({ hasText: MOVER });
  await expect(chip(row, "Neue offen")).toBeVisible();
  await mailedMessage(newAddress, "Neue E-Mail-Adresse bestätigen", before);

  await pressRowAct(row, "Verwerfen");
  const discard = page.getByRole("alertdialog");
  await discard.getByRole("button", { name: "Verwerfen" }).click();
  await expect(discard).toBeHidden();
  await expect(row).toHaveCount(0);

  // --- Löschungen --------------------------------------------------------------------------------

  await page.goto("/admin/erasures");
  const main = page.getByRole("main");
  await typeInto(main.getByRole("textbox", { name: /^E-Mail-Adresse/ }), ERASED);
  await typeInto(main.getByRole("textbox", { name: /^Referenz der Anfrage/ }), REFERENCE);
  await main.getByRole("button", { name: "Löschen" }).click();

  // The counts the press read, and no name: the person's one record is a referee's.
  const question = page.getByRole("alertdialog");
  await expect(question).toContainText("Schiedsrichter");
  await question.getByRole("button", { name: "Löschen" }).click();
  await expect(question).toBeHidden();
  await expect(main.getByText("Gelöscht", { exact: true })).toBeVisible();
  expect(await assertionsSigned(context), "an act of this area ran with no touch of its own").toBe(touches + 3);

  // --- Protokoll ---------------------------------------------------------------------------------

  await page.goto("/admin/log");
  await chooseWho(page, main, ADMINISTRATOR);
  const logged = main.getByRole("row");
  await expect(logged.filter({ hasText: "Adressänderung eingetragen" })).toBeVisible();
  await expect(logged.filter({ hasText: "Adressänderung verworfen" })).toBeVisible();
  await expect(logged.filter({ hasText: `Löschung auf Anfrage · ${REFERENCE}` })).toBeVisible();
});
