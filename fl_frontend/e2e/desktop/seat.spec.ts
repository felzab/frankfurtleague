/**
 * E2E · a seat written anew on an application, where no lower tier sees an objection's emptied seat take another person
 * behind the administrator's real touch, or the fresh link that write owes fail to seat them. Desktop alone, the
 * administrator holding a passkey, since Playwright's WebKit holds no authenticator.
 */
import { expect } from "@playwright/test";

import { apply, confirmSeat, fillSeat, openApplication, personOf, SUBJECT } from "../support/application";
import { enteredDialog, enteredQuestion, pressRowAct, toast } from "../support/controls";
import { test } from "../support/journey";
import { PEOPLE, PLANNED } from "../support/madeUpLeague";
import { filedMessages, mailedLink, mailedMessage } from "../support/mailSink";
import { assertionsSigned, enrolPasskey, signInWithCode } from "../support/signIn";

/** The administrator who writes the seat, on the second device, whom no other journey signs in as. */
const ADMINISTRATOR = PEOPLE.administrators.seat;

test("a seat objects, „Sitz bearbeiten“ seats another person behind the touch, and the fresh link confirms them", async ({
  page,
  secondDevice: desk,
  objected: school,
}) => {
  const before = await filedMessages();

  await page.goto(`/bewerbung/${PLANNED}`);
  await apply(page, school, { isListed: false });

  // The Stellvertretung objects, which empties the seat and tells the Ansprechperson.
  await page.goto(await mailedLink(personOf(school, "stellvertretung").address, SUBJECT.seat, before));
  await page.getByRole("main").getByRole("button", { name: "Widersprechen" }).click();
  // The objection asks before it acts; its question's own press does it.
  await (await enteredQuestion(page, "Eintrag widersprechen?")).getByRole("button", { name: "Widersprechen" }).click();
  await expect(page.getByRole("main").getByRole("heading", { name: "Widersprochen", exact: true })).toBeVisible();
  await mailedMessage(personOf(school, "ansprechperson").address, SUBJECT.objected, before);

  // The emptied seat's row takes another person, the write behind the administrator's touch.
  await signInWithCode(desk, ADMINISTRATOR);
  await enrolPasskey(desk, desk.context());
  const touches = await assertionsSigned(desk.context());
  await openApplication(desk, school);
  const seats = desk.getByRole("list", { name: "Kontaktpersonen" }).getByRole("listitem");
  const replaced = await filedMessages();
  await pressRowAct(seats.filter({ hasText: "Niemand" }), "Sitz bearbeiten");
  const dialog = await enteredDialog(desk, "Sitz bearbeiten");
  const replacement = { firstName: "Noah", lastName: "Neumann", address: `neu.${school.toLowerCase()}@example.com`, phone: "069 90009004" };
  await fillSeat(dialog, replacement);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  // The press sends the dry run, steps the dialog aside for the touch and closes it once the write is done; the write
  // owes the person a link, which the toast names.
  await expect(dialog).toBeHidden();
  await expect(toast(desk, replacement.address)).toBeVisible();
  expect(await assertionsSigned(desk.context()), "the seat was written with no touch of its own").toBe(touches + 1);

  // The seat's fresh link is the new person's, and their confirmation fills it.
  await confirmSeat(page, await mailedLink(replacement.address, SUBJECT.seat, replaced));
  await desk.reload();
  const seated = seats.filter({ hasText: `${replacement.firstName} ${replacement.lastName}` });
  await expect(seated.getByText("Bestätigt", { exact: true })).toBeVisible();
});
