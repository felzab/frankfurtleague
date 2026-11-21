/**
 * E2E · a banned person: an administrator bans a person, behind the administrator's real touch. The person is told by
 * mail and their session ends. Desktop alone, the administrator holding a passkey, since Playwright's WebKit holds no
 * authenticator.
 */
import { expect } from "@playwright/test";

import { enteredDialog, enteredQuestion, typeInto } from "../support/controls";
import { test } from "../support/journey";
import { PEOPLE } from "../support/madeUpLeague";
import { filedMessages, mailedMessage } from "../support/mailSink";
import { assertionsSigned, enrolPasskey, expectLandedAt, PERSON_LANDING, signInWithCode } from "../support/signIn";

/** The person this journey bans, whom no other journey signs in as. */
const PERSON = PEOPLE.access.banned.address;

/** The administrator who bans them, on the second device, whom no other journey signs in as. */
const ADMINISTRATOR = PEOPLE.administrators.banning;

test("a banned person is told and loses their session", async ({ page, secondDevice: desk }) => {
  // The person: an account, so the ban owes its mail, and a session, which the ban ends.
  await signInWithCode(page, PERSON);
  await expectLandedAt(page, PERSON_LANDING);

  // The ban, behind the administrator's touch.
  await signInWithCode(desk, ADMINISTRATOR);
  await enrolPasskey(desk, desk.context());
  const touches = await assertionsSigned(desk.context());
  const before = await filedMessages();
  await desk.goto("/admin/ban-list");
  await desk.getByRole("button", { name: "Sperre eintragen" }).click();
  const dialog = await enteredDialog(desk, "Sperre eintragen");
  await typeInto(dialog.getByRole("textbox", { name: /^E-Mail-Adresse/ }), PERSON);
  await typeInto(dialog.getByRole("textbox", { name: /^Grund/ }), "Beleidigungen am Spielfeldrand");
  await dialog.getByRole("button", { name: "Sperre eintragen" }).click();
  await expect(dialog).toBeHidden();
  const row = desk.getByRole("main").getByRole("row").filter({ hasText: PERSON });
  await expect(row).toBeVisible();

  await mailedMessage(PERSON, "Deine E-Mail-Adresse ist gesperrt", before);

  // The session went with the ban.
  await page.goto("/account/signin");
  await expect(page).toHaveURL((url) => url.pathname === "/signin");

  // Lifted from its row, behind a touch of its own.
  await row.getByRole("button", { name: "Entfernen" }).click();
  const question = await enteredQuestion(desk, "Sperre entfernen?");
  await question.getByRole("button", { name: "Entfernen" }).click();
  await expect(question).toBeHidden();
  await expect(row).toHaveCount(0);
  expect(await assertionsSigned(desk.context()), "an act on the Sperrliste ran with no touch of its own").toBe(touches + 2);
});
