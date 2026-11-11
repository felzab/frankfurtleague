/**
 * E2E · an application as its people make it: the public form's five boxes, a seat's confirmation from its mailed link,
 * and an administrator's way to the application's review page. The planned season of `scripts/ops/seed/seed.js` is the
 * one its window is open for.
 */
import { expect } from "@playwright/test";

import type { Locator, Page } from "@playwright/test";

/** The planned season the made-up seed holds open. */
export const SAISON = "2028";

/** Each seat's box on the form, by its title, in the form's order. */
const SEAT_TITLE = { trainer: "Trainerin oder Trainer", ansprechperson: "Ansprechperson", stellvertretung: "Stellvertretung" };

type Seat = keyof typeof SEAT_TITLE;

/** The three seats of an application, in the form's order. */
export const SEATS = ["trainer", "ansprechperson", "stellvertretung"] as const satisfies readonly Seat[];

/** One person, as a seat's four boxes take them. */
type Person = { firstName: string; lastName: string; address: string; phone: string };

/** A mail's subject, by its season. */
export const SUBJECT = {
  received: `Bewerbung für die Saison ${SAISON} eingegangen`,
  seat: `Eintrag für die Saison ${SAISON} bestätigen`,
  accepted: `Zusage für die Saison ${SAISON}`,
  declined: `Absage für die Saison ${SAISON}`,
  objected: `Widerspruch zum Eintrag: Saison ${SAISON}`,
  deleted: `Bewerbung für die Saison ${SAISON} gelöscht`,
};

/** The person holding `seat` of `school`, whom no other seat or journey names. */
export function personOf(school: string, seat: Seat): Person {
  const name = school.toLowerCase();
  return {
    firstName: "Lea",
    lastName: seat === "trainer" ? "Trainer" : seat === "ansprechperson" ? "Kontakt" : "Vertretung",
    address: `${seat}.${name}@example.com`,
    phone: seat === "trainer" ? "069 90009001" : seat === "ansprechperson" ? "069 90009002" : "069 90009003",
  };
}

/**
 * Types into a box. Tapped first, as a person reaches it and `./signIn.ts :: sendFromHere` taps its field.
 */
export async function typeInto(box: Locator, value: string): Promise<void> {
  await box.click();
  await box.fill(value);
}

/**
 * Presses a row's act by its name, as a person finds it: the row's own button where the row shows one, else the row's
 * „Mehr“ and then the menu's entry of that name. A row's acts have these two homes by their list, at every width: a
 * decision and a list's one side act are buttons, and the side acts of a list whose rows carry two or more stand in
 * each row's one „⋯“. It fails where the row shows neither.
 */
export async function pressRowAct(row: Locator, name: string): Promise<void> {
  const button = row.getByRole("button", { name, exact: true });
  const more = row.getByRole("button", { name: "Mehr", exact: true });
  await expect(button.or(more)).toBeVisible();
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  await more.click();
  await row.page().getByRole("menuitem", { name, exact: true }).click();
}

/**
 * Opens the select `label` names inside `scope` and presses `option`, which its list shows in a pop-over of the page's. A
 * select's button is named by its value, then its label (`useSelect`), so only a select holding no value starts on its label.
 */
export async function choose(page: Page, scope: Locator, label: RegExp, option: string | RegExp): Promise<void> {
  await scope.getByRole("button", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** The form's box under `title`: a box carries its title as a heading, and no landmark. */
function box(page: Page, title: string): Locator {
  return page.getByRole("main").locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });
}

/** A seat's four boxes, the labels by their start: a required field's label ends in its asterisk. */
export async function fillSeat(scope: Locator, person: Person): Promise<void> {
  await typeInto(scope.getByRole("textbox", { name: /^Vorname/ }), person.firstName);
  await typeInto(scope.getByRole("textbox", { name: /^Nachname/ }), person.lastName);
  await typeInto(scope.getByRole("textbox", { name: /^E-Mail-Adresse/ }), person.address);
  await typeInto(scope.getByRole("textbox", { name: /^Telefon/ }), person.phone);
}

/**
 * The new school's fields, behind the switch a school the list lacks turns on. Pressed on its words, as a person presses it:
 * React Aria clips the switch's own input to nothing, so a pointer aimed at it lands on whatever stands there, and `check`
 * follows the words' label to that input to read it turned on.
 */
async function fillNewSchool(page: Page, school: string): Promise<void> {
  const fields = box(page, "Schule");
  await fields.getByText("Meine Schule ist nicht in der Liste", { exact: true }).check();
  await typeInto(fields.getByRole("textbox", { name: /^Teamname/ }), school);
  await typeInto(fields.getByRole("textbox", { name: /^Vollständiger Name/ }), `${school}-Gymnasium`);
  await choose(page, fields, /^Schulform/, "Gesamtschule");
  await typeInto(fields.getByRole("textbox", { name: /^Straße/ }), "Schulweg");
  await typeInto(fields.getByRole("textbox", { name: /^Nr\./ }), "9");
  await typeInto(fields.getByRole("textbox", { name: /^PLZ/ }), "60431");
  await typeInto(fields.getByRole("textbox", { name: /^Stadtteil/ }), "Nordend");
}

/** A school the form lists, picked by typing its name, as a person finds one among many. */
async function pickSchool(page: Page, school: string): Promise<void> {
  await typeInto(box(page, "Schule").getByRole("combobox", { name: /^Schule/ }), school);
  await page.getByRole("option", { name: school, exact: true }).click();
}

/**
 * Sends the application on the form the browser stands on, as far as the card replacing it. `isListed` picks the school
 * from the form's list, and otherwise the switch reveals a new one's fields.
 */
export async function apply(page: Page, school: string, { isListed }: { isListed: boolean }): Promise<void> {
  if (isListed) await pickSchool(page, school);
  else await fillNewSchool(page, school);
  await typeInto(box(page, "Schule").getByRole("textbox", { name: /^Größe der Stufe/ }), "90");

  for (const seat of SEATS) await fillSeat(box(page, SEAT_TITLE[seat]), personOf(school, seat));

  const team = box(page, "Team");
  await choose(page, team, /^Wunschfarbe/, "Rot");
  await typeInto(team.getByRole("textbox", { name: /^Voraussichtliche Kadergröße/ }), "14");
  await typeInto(team.getByRole("textbox", { name: /^Davon im Verein/ }), "3");

  await page.getByRole("main").getByRole("button", { name: "Bewerbung abschicken" }).click();
  await expect(page.getByRole("main").getByRole("heading", { name: "Bewerbung abgeschickt" })).toBeVisible();
}

/** Answers a seat's mailed link with a birthdate, as far as the page's own end. */
export async function confirmSeat(page: Page, link: string): Promise<void> {
  await page.goto(link);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Eintrag bestätigen" })).toBeVisible();

  // The day, the month and the year in their segments, each moving on by itself once full. React Aria makes a segment a
  // text box where the browser says it is an iPhone, and a spin button everywhere else (`useDateSegment`).
  const birthDate = main.getByRole("group", { name: /^Geburtsdatum/ });
  await birthDate.getByRole("spinbutton").or(birthDate.getByRole("textbox")).first().click();
  await page.keyboard.type("01011990");
  await main.getByRole("button", { name: "Eintrag bestätigen" }).click();
  // By its exact title: the same link read again is titled with the day.
  await expect(main.getByRole("heading", { name: "Eintrag bestätigt", exact: true })).toBeVisible();
}

/** An administrator's way to one application: its row in the season's list, which opens its review page. */
export async function openApplication(page: Page, school: string): Promise<void> {
  await page.goto(`/admin/saisons/${SAISON}/bewerbungen`);
  await page.getByRole("main").getByRole("link", { name: school, exact: true }).click();
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: school })).toBeVisible();
}
