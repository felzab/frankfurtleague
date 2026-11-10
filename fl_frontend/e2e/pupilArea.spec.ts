/**
 * E2E · the pupil's path, under each project: their team's registration link, the form, the confirmation from the
 * mailed link, the team's admission on its Registrierungen page, and the pupil's first sign-in onto their own season.
 *
 * The pupil is new to the league, so the journey makes them, as an applicant's journey makes its school: one of the
 * project's own, registering through the project's `registering` club, whose confirmed contact seat admits them on a
 * second device of the journey's own visitor. Nothing is seeded for the pupil, so no other journey reads them.
 */
import { expect } from "@playwright/test";

import { choose, typeInto } from "./support/application";
import { test as journey } from "./support/journey";
import { filedMessages, mailedLink } from "./support/mailSink";
import { declinePasskeyOffer, signInWithCode } from "./support/signIn";
import { standInForTurnstile } from "./support/turnstileStandIn";

import type { Locator, Page } from "@playwright/test";

/** The running season of the made-up seed, which the club's link registers for. */
const SAISON = "2027";

/** Where a contact seat holding one team lands: its Übersicht of the season, under the team's id, which the seed mints. */
const TEAM_OVERVIEW = new RegExp(`^/area/team/[0-9a-f]{24}/${SAISON}$`);

/** The pupil the journey registers through `club`'s link, and what they answer of the squad's three optional fields. */
function pupilOf(club: string) {
  return {
    firstName: "Nele",
    lastName: "Neumann",
    address: `nele.neumann.${club.toLowerCase()}@schule.example`,
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

/** A fact's value, which its term names for a screen reader. */
function valueOf(scope: Locator, term: string): Locator {
  return scope.getByRole("definition", { name: term, exact: true });
}

/**
 * The team contact's device beside the pupil's, as `accountActs.spec.ts` builds its second device: on the journey's
 * proxy, so it is the same visitor and closes before the edge is read.
 */
const test = journey.extend<{ team: Page }>({
  team: async ({ browser, proxy }, provide) => {
    const device = await browser.newContext({ proxy });
    await standInForTurnstile(device);
    await provide(await device.newPage());
    await device.close();
  },
});

test("a pupil registers through their team's link, confirms, is admitted, and finds their season", async ({
  page,
  team,
  registering: { club, token, admitter },
}) => {
  const pupil = pupilOf(club);
  const name = `${pupil.firstName} ${pupil.lastName}`;
  const before = await filedMessages();

  // The team's link opens the form, „Deine Angaben“ in one box.
  await page.goto(`/registrierung?token=${token}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { name: "Registrierung", exact: true })).toBeVisible();
  const box = main.locator("section", { has: page.getByRole("heading", { name: "Deine Angaben", exact: true }) });
  await typeInto(box.getByRole("textbox", { name: /^Vorname/ }), pupil.firstName);
  await typeInto(box.getByRole("textbox", { name: /^Nachname/ }), pupil.lastName);
  await typeInto(box.getByRole("textbox", { name: /^E-Mail-Adresse/ }), pupil.address);
  await typeInto(box.getByRole("textbox", { name: /^Trikotnummer/ }), pupil.nummer);
  await choose(page, box, /Position/, pupil.position);
  await choose(page, box, /Stufe/, pupil.stufe);
  await main.getByRole("button", { name: "Registrierung abschicken" }).click();
  // The outcome in the form's place says what the pupil does next.
  await expect(main.getByRole("heading", { name: "Bestätige deine Registrierung per E-Mail" })).toBeVisible();

  // The mailed link asks the birthdate and what of the name the site may show.
  await page.goto(await mailedLink(pupil.address, `Registrierung für ${club} bestätigen`, before));
  await expect(main.getByRole("heading", { name: "Registrierung bestätigen" })).toBeVisible();
  // React Aria makes a segment a text box where the browser says it is an iPhone, and a spin button everywhere else.
  const birthday = main.getByRole("group", { name: /^Geburtsdatum/ });
  await birthday.getByRole("spinbutton").or(birthday.getByRole("textbox")).first().click();
  await page.keyboard.type(birthDate());
  // Pressed on its words, as a person presses it: React Aria clips the radio's own input to nothing.
  await main.getByText("Vorname und Anfangsbuchstabe des Nachnamens", { exact: true }).check();
  await main.getByRole("button", { name: "Registrierung bestätigen" }).click();
  // By its exact title: the same link read again is titled with the day.
  await expect(main.getByRole("heading", { name: "Registrierung bestätigt", exact: true })).toBeVisible();

  // The team's contact finds the confirmed registration on the Übersicht, and its row opens the Registrierungen.
  await signInWithCode(team, admitter);
  await declinePasskeyOffer(team, TEAM_OVERVIEW);
  await team.getByRole("main").getByRole("link", { name, exact: true }).click();
  await expect(team).toHaveURL((url) => url.pathname.endsWith("/registrierungen"));
  const row = team.getByRole("main").getByRole("row").filter({ hasText: name });
  await expect(row.getByText("Bestätigt", { exact: true })).toBeVisible();
  // The row opens its dialog, titled by the pupil's name, which holds „Aufnehmen“ (D747).
  await row.getByRole("button", { name, exact: true }).click();
  await team.getByRole("dialog", { name }).getByRole("button", { name: "Aufnehmen", exact: true }).click();
  // The admission's end: the registration leaves the open list for the squad.
  await expect(row).toHaveCount(0);

  // Admitted, the pupil signs in and lands on their own season: their club, number, position and Stufe.
  await signInWithCode(page, pupil.address);
  await declinePasskeyOffer(page, `/area/spieler/${SAISON}`);
  await expect(valueOf(main, "Team").getByRole("link", { name: club, exact: true })).toBeVisible();
  await expect(valueOf(main, "Nummer")).toHaveText(pupil.nummer);
  await expect(valueOf(main, "Position")).toHaveText(pupil.position);
  await expect(valueOf(main, "Stufe")).toHaveText(pupil.stufe);
});
