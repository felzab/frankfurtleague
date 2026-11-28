/**
 * E2E · an application, under each project, where no lower tier sees the form, a seat's mailed link or the acceptance
 * break at a join between them, the public form's real controls fail on either engine, or a rejection's reason miss a
 * seat. Each project's schools are its own (`applicants`). A seat written anew asks the passkey touch, which the shared
 * administrator's device cannot answer, so its journey is desktop's alone.
 */
import { expect } from "@playwright/test";

import { apply, confirmSeat, openApplication, personOf, SEATS, SUBJECT } from "./support/application";
import { choose, enteredDialog, typeInto } from "./support/controls";
import { test } from "./support/journey";
import { PLANNED } from "./support/madeUpLeague";
import { filedMessages, mailedLink, mailedMessage } from "./support/mailSink";

import type { Page } from "@playwright/test";

/** The page's title strip, where the record's status chip stands beside its name, rather than the same word anywhere on the page. */
const strip = (page: Page) => page.getByRole("main").locator("header", { has: page.getByRole("heading", { level: 1 }) });

test("a new school applies, every seat confirms, and the administration accepts it", async ({ page, administration, applicants }) => {
  const school = applicants.accepted;
  const before = await filedMessages();

  // The landing's way in while the window is open.
  await page.goto("/");
  await page.getByRole("main").getByRole("link", { name: "Zur Bewerbung" }).first().click();
  await expect(page).toHaveURL((url) => url.pathname === "/bewerbung");
  await apply(page, school, { isListed: false });

  // Each person's own link: the Ansprechperson's in the mail saying the application came in.
  await confirmSeat(page, await mailedLink(personOf(school, "ansprechperson").address, SUBJECT.received, before));
  await confirmSeat(page, await mailedLink(personOf(school, "trainer").address, SUBJECT.seat, before));
  await confirmSeat(page, await mailedLink(personOf(school, "stellvertretung").address, SUBJECT.seat, before));

  // The application stands complete, and the acceptance sets what the form never asked: a new school's Kürzel.
  await openApplication(administration, school);
  await expect(strip(administration).getByText("Vollständig", { exact: true })).toBeVisible();
  const decided = await filedMessages();
  await administration.getByRole("main").getByRole("button", { name: "Annehmen", exact: true }).click();
  const dialog = await enteredDialog(administration, "Bewerbung annehmen");
  await choose(administration, dialog, /^Gruppe/, /^Gruppe A/);
  // The box opens on the wish, and a colour given away closes on the form every later application fills.
  await choose(administration, dialog, /Trikotfarbe/, "Nicht hinterlegt");
  await typeInto(dialog.getByRole("textbox", { name: /^Kürzel/ }), school.slice(0, 3).toUpperCase());
  await dialog.getByRole("button", { name: "Annehmen", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(strip(administration).getByText("Angenommen", { exact: true })).toBeVisible();

  // Every seat is told, and the school now is a team of the season, whose editor the application leads to.
  for (const seat of SEATS) await mailedMessage(personOf(school, seat).address, SUBJECT.accepted, decided);
  await administration.getByRole("main").getByRole("link", { name: "Zum Team" }).click();
  await expect(administration).toHaveURL((url) => url.pathname.startsWith(`/admin/saisons/${PLANNED}/teams/`));
  await expect(administration.getByRole("main").getByRole("heading", { level: 1, name: school })).toBeVisible();
});

test("a listed school is rejected, and every seat reads the reason", async ({ page, administration, applicants }) => {
  const school = applicants.declined;
  const reason = "Die Saison ist schon voll.";

  await page.goto(`/bewerbung/${PLANNED}`);
  await apply(page, school, { isListed: true });

  // A rejection waits for no confirmation.
  await openApplication(administration, school);
  const decided = await filedMessages();
  await administration.getByRole("main").getByRole("button", { name: "Ablehnen", exact: true }).click();
  const dialog = await enteredDialog(administration, "Bewerbung ablehnen");
  await typeInto(dialog.getByRole("textbox", { name: /^Grund/ }), reason);
  await dialog.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(strip(administration).getByText("Abgelehnt", { exact: true })).toBeVisible();

  for (const seat of SEATS) {
    const mail = await mailedMessage(personOf(school, seat).address, SUBJECT.declined, decided);
    expect(mail.join("\n"), `the rejection mailed to the ${seat}`).toContain(reason);
  }
});
