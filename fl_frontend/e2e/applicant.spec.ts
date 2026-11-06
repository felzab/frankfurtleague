/**
 * E2E · J2, an applicant, under each project: the form from the landing, every seat's mailed link, and the administrator's
 * acceptance; then the rejection, and the objection with „Sitz bearbeiten“ and the fresh link. Each is a school of the
 * project's own (`applicants`), since each ends its application differently. The way 14 days lapse is
 * `firstPass.spec.ts`'s. The administration's half runs on the session `support/administrator.setup.ts` saved.
 */
import { expect } from "@playwright/test";

import { apply, choose, confirmSeat, fillSeat, openApplication, personOf, SAISON, SEATS, SUBJECT, typeInto } from "./support/application";
import { test } from "./support/journey";
import { filedMessages, mailedLink, mailedMessage } from "./support/mailSink";

test("a new school applies, every seat confirms, and the administration accepts it", async ({ page, administration, applicants }) => {
  const school = applicants.accepted;
  const before = await filedMessages();

  // The landing's way in while the window is open.
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Zur Bewerbung" }).first().click();
  await expect(page).toHaveURL((url) => url.pathname === `/bewerbung/${SAISON}`);
  await apply(page, school, { isListed: false });

  // Each person's own link: the Ansprechperson's in the mail saying the application came in.
  await confirmSeat(page, await mailedLink(personOf(school, "ansprechperson").address, SUBJECT.received, before));
  await confirmSeat(page, await mailedLink(personOf(school, "trainer").address, SUBJECT.seat, before));
  await confirmSeat(page, await mailedLink(personOf(school, "stellvertretung").address, SUBJECT.seat, before));

  // The application stands complete, and the acceptance sets what the form never asked: a new school's Kürzel.
  await openApplication(administration, school);
  await expect(administration.getByRole("banner").getByText("Vollständig", { exact: true })).toBeVisible();
  const decided = await filedMessages();
  await administration.getByRole("main").getByRole("button", { name: "Annehmen", exact: true }).click();
  const dialog = administration.getByRole("dialog", { name: "Bewerbung annehmen" });
  await choose(administration, dialog, /^Gruppe/, /^Gruppe A/);
  await typeInto(dialog.getByRole("textbox", { name: /^Kürzel/ }), school.slice(0, 3).toUpperCase());
  await dialog.getByRole("button", { name: "Annehmen", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(administration.getByRole("banner").getByText("Angenommen", { exact: true })).toBeVisible();

  // Every seat is told, and the school now is a team of the season, whose editor the application leads to.
  for (const seat of SEATS) await mailedMessage(personOf(school, seat).address, SUBJECT.accepted, decided);
  await administration.getByRole("main").getByRole("link", { name: "Zum Team" }).click();
  await expect(administration).toHaveURL((url) => url.pathname.startsWith(`/admin/saisons/${SAISON}/teams/`));
  await expect(administration.getByRole("banner").getByRole("heading", { level: 1, name: school })).toBeVisible();
});

test("a listed school is rejected, and every seat reads the reason", async ({ page, administration, applicants }) => {
  const school = applicants.declined;
  const reason = "Die Saison ist schon voll.";

  await page.goto(`/bewerbung/${SAISON}`);
  await apply(page, school, { isListed: true });

  // A rejection waits for no confirmation.
  await openApplication(administration, school);
  const decided = await filedMessages();
  await administration.getByRole("main").getByRole("button", { name: "Ablehnen", exact: true }).click();
  const dialog = administration.getByRole("dialog", { name: "Bewerbung ablehnen" });
  await typeInto(dialog.getByRole("textbox", { name: /^Begründung/ }), reason);
  await dialog.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(administration.getByRole("banner").getByText("Abgelehnt", { exact: true })).toBeVisible();

  for (const seat of SEATS) {
    const mail = await mailedMessage(personOf(school, seat).address, SUBJECT.declined, decided);
    expect(mail.join("\n"), `the rejection mailed to the ${seat}`).toContain(reason);
  }
});

test("a seat objects, „Sitz bearbeiten“ seats another person, and the fresh link confirms them", async ({
  page,
  administration,
  applicants,
}) => {
  const school = applicants.objected;
  const before = await filedMessages();

  await page.goto(`/bewerbung/${SAISON}`);
  await apply(page, school, { isListed: false });

  // The Stellvertretung objects, which empties the seat and tells the Ansprechperson.
  await page.goto(await mailedLink(personOf(school, "stellvertretung").address, SUBJECT.seat, before));
  await page.getByRole("main").getByRole("button", { name: "Widersprechen" }).click();
  await expect(page.getByRole("main").getByRole("heading", { name: "Widersprochen", exact: true })).toBeVisible();
  await mailedMessage(personOf(school, "ansprechperson").address, SUBJECT.objected, before);

  // The emptied seat, third of the review page's rows, takes another person.
  await openApplication(administration, school);
  const seats = administration.getByRole("main");
  await expect(seats.getByText("Niemand", { exact: true })).toBeVisible();
  const replaced = await filedMessages();
  await seats.getByRole("button", { name: "Sitz bearbeiten" }).nth(2).click();
  const dialog = administration.getByRole("dialog", { name: "Sitz bearbeiten" });
  const replacement = { firstName: "Noah", lastName: "Neumann", address: `neu.${school.toLowerCase()}@example.com`, phone: "069 90009004" };
  await fillSeat(dialog, replacement);
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toBeHidden();

  // The seat's fresh link is the new person's, and their confirmation fills it.
  await confirmSeat(page, await mailedLink(replacement.address, SUBJECT.seat, replaced));
  await administration.reload();
  await expect(seats.getByRole("button", { name: "Sitz bearbeiten" }).first()).toBeVisible();
  await expect(seats.getByText("Niemand", { exact: true })).toHaveCount(0);
});
