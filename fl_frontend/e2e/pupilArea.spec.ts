/**
 * E2E · a pupil's path, under each project, where no lower tier sees the team's link, the form, the mailed confirmation,
 * the team's admission or the first sign-in break at a join between them. The journey makes its pupil, whom no other
 * journey reads.
 */
import { expect } from "@playwright/test";

import { box, chip, choose, enteredDialog, typeInto, valueOf } from "./support/controls";
import { test } from "./support/journey";
import { RUNNING } from "./support/madeUpLeague";
import { filedMessages, mailedLink } from "./support/mailSink";
import { expectLandedAt, signInWithCode } from "./support/signIn";

/** Where a contact seat holding one team lands: its Übersicht of the season, under the team's id, which the seed mints. */
const TEAM_OVERVIEW = new RegExp(`^/area/team/[0-9a-f]{24}/${RUNNING}$`);

/** The pupil the journey registers through `team`'s link, and what they answer of the squad's three optional fields. */
function pupilOf(team: string) {
  return {
    firstName: "Nele",
    lastName: "Neumann",
    address: `nele.neumann.${team.toLowerCase()}@schule.example`,
    nummer: "27",
    position: "Abwehr",
    stufe: "Q2",
  };
}

/**
 * The first of January seventeen years back: a full sixteen on every day of the year, which the confirmation's floor
 * asks, and short of the media consent's eighteen, so the form offers no media box.
 */
function birthDate(): string {
  return `0101${String(new Date().getFullYear() - 17)}`;
}

test("a pupil registers through their team's link, confirms, is admitted, and finds their season", async ({
  page,
  // The team contact's device beside the pupil's.
  secondDevice: team,
  registering: { team: teamName, token, admitter },
}) => {
  const pupil = pupilOf(teamName);
  const name = `${pupil.firstName} ${pupil.lastName}`;
  const before = await filedMessages();

  // The team's link opens the form, „Deine Angaben“ in one box.
  await page.goto(`/registrierung?token=${token}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Registrierung", exact: true })).toBeVisible();
  const details = box(page, "Deine Angaben");
  await typeInto(details.getByRole("textbox", { name: /^Vorname/ }), pupil.firstName);
  await typeInto(details.getByRole("textbox", { name: /^Nachname/ }), pupil.lastName);
  await typeInto(details.getByRole("textbox", { name: /^E-Mail-Adresse/ }), pupil.address);
  await typeInto(details.getByRole("textbox", { name: /^Trikotnummer/ }), pupil.nummer);
  await choose(page, details, /Position/, pupil.position);
  await choose(page, details, /Stufe/, pupil.stufe);
  await main.getByRole("button", { name: "Registrierung abschicken" }).click();
  // The outcome in the form's place says what the pupil does next.
  await expect(main.getByRole("heading", { name: "Bestätige deine Registrierung per E-Mail" })).toBeVisible();

  // The mailed link asks the birthdate and what of the name the site may show.
  await page.goto(await mailedLink(pupil.address, `Registrierung bestätigen: ${teamName}`, before));
  await expect(main.getByRole("heading", { name: "Registrierung bestätigen" })).toBeVisible();
  // React Aria makes a segment a text box where the browser says it is an iPhone, and a spin button everywhere else.
  const birthday = main.getByRole("group", { name: /^Geburtsdatum/ });
  await birthday.getByRole("spinbutton").or(birthday.getByRole("textbox")).first().click();
  await page.keyboard.type(birthDate());
  // Pressed on its words, as a person presses it: React Aria clips the radio's own input to nothing.
  await main.getByText("Vorname und Anfangsbuchstabe des Nachnamens", { exact: true }).check();
  await main.getByRole("button", { name: "Registrierung bestätigen" }).click();
  // On the done page the answer leads to, the link forgotten.
  await expect(page).toHaveURL((url) => url.pathname === "/confirm/spieler/done");
  await expect(main.getByRole("heading", { name: "Registrierung bestätigt", exact: true })).toBeVisible();

  // The team's contact finds the registration on the Übersicht, whose card's title opens the Registrierungen: a
  // registration has no page of its own, so its row links nothing.
  await signInWithCode(team, admitter);
  await expectLandedAt(team, TEAM_OVERVIEW);
  const registrierungen = box(team, "Registrierungen");
  await expect(registrierungen.getByText(name, { exact: true })).toBeVisible();
  await registrierungen.getByRole("link", { name: "Registrierungen", exact: true }).click();
  await expect(team).toHaveURL((url) => url.pathname.endsWith("/registrierungen"));
  const row = team.getByRole("main").getByRole("row").filter({ hasText: name });
  await expect(chip(row, "Bestätigt")).toBeVisible();
  // The row opens its dialog, titled by the pupil's name, which holds „Aufnehmen“.
  await row.getByRole("button", { name, exact: true }).click();
  await (await enteredDialog(team, name)).getByRole("button", { name: "Aufnehmen", exact: true }).click();
  // The admission's end: the registration leaves the open list for the squad.
  await expect(row).toHaveCount(0);

  // Admitted, the pupil signs in and lands on their own season: their club, number, position and Stufe.
  await signInWithCode(page, pupil.address);
  await expectLandedAt(page, "/area/spieler");
  await expect(valueOf(main, "Team").getByRole("link", { name: teamName, exact: true })).toBeVisible();
  await expect(valueOf(main, "Nummer")).toHaveText(pupil.nummer);
  await expect(valueOf(main, "Position")).toHaveText(pupil.position);
  await expect(valueOf(main, "Stufe")).toHaveText(pupil.stufe);
});
