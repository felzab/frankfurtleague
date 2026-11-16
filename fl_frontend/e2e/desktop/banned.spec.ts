/**
 * E2E · a banned person: an administrator bans a person who holds a passkey, behind the administrator's real touch. The
 * person is told by mail, their session ends, and their passkey meets the sign-in's one sentence, which an address
 * holding no record meets too, so nobody can probe the list. Desktop alone, both people holding a passkey, since
 * Playwright's WebKit holds no authenticator.
 */
import { expect } from "@playwright/test";

import { typeInto } from "../support/controls";
import { test } from "../support/journey";
import { PEOPLE } from "../support/madeUpLeague";
import { filedMessages, mailedMessage } from "../support/mailSink";
import { assertionsSigned, declinePasskeyOffer, enrolPasskey, PERSON_LANDING, setUpPasskey, signInWithCode } from "../support/signIn";

/** The person this journey bans, whom no other journey signs in as. */
const PERSON = PEOPLE.access.banned.address;

/** The administrator who bans them, on the second device, whom no other journey signs in as. */
const ADMINISTRATOR = PEOPLE.administrators.banning;

test("a banned person is told, loses their session and cannot sign in, by the sentence", async ({ page, context, secondDevice: desk }) => {
  // The person: an account, so the ban owes its mail, and a passkey, which outlives the session the ban ends.
  await signInWithCode(page, PERSON);
  await declinePasskeyOffer(page, PERSON_LANDING);
  await setUpPasskey(page, context);

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
  await expect(page.getByRole("main").getByText("Mit dieser Adresse ist keine Anmeldung möglich.")).toBeVisible();

  // Lifted from its row, behind a touch of its own. The question is named: the ban's toast is an `alertdialog` too.
  await row.getByRole("button", { name: "Entfernen" }).click();
  const question = desk.getByRole("alertdialog", { name: "Sperre entfernen?" });
  await question.getByRole("button", { name: "Entfernen" }).click();
  await expect(question).toBeHidden();
  await expect(row).toHaveCount(0);
  expect(await assertionsSigned(desk.context()), "an act on the Sperrliste ran with no touch of its own").toBe(touches + 2);
});
