import { describe, expect, it } from "vitest";

import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { ROUTES } from "@/core/routes";
import { person, seat } from "@/test-support/subjectFixtures";

import { landingTargetOf, owesSignInStep, placeOf, placesOf } from "./utils";

import type { SubjectSession } from "@/core/subject";

const TEAM = seat();
/** Another club's seat on a season that is over, which opens nothing. */
const PAST_TEAM = seat({ team_id: "6890a1b2c3d4e5f607250022", saison_id: "2425", saison_status: "past" });

/** The same club's seat on the season after `TEAM`'s, held as the Trainer, under the Kürzel the club plays it under. */
const NEXT_SEASON = seat({ saison_id: "2627", saison_status: "future", seat: "trainer", team_shorthand: "NEU" });

const landingOf = (subject: SubjectSession) => landingTargetOf(placesOf(subject));

// The harm: the landing redirects before anything is drawn, so a person sent into a place they do not hold, or to a
// chooser of one card, sees only where they arrive.
describe("where a person's landing sends them", () => {
  it("sends a person holding no place to Konto", () => {
    expect(landingOf(person())).toBe(ROUTES.account.path());
    expect(landingOf(person({ seats: [PAST_TEAM] }))).toBe(ROUTES.account.path());
    // A grant the administrator's lane refuses opens no administration.
    expect(landingOf(person({ admin_tier: "administration" }))).toBe(ROUTES.account.path());
  });

  it("sends a person holding one place to that place, whatever its kind", () => {
    expect(landingOf(person({ seats: [TEAM] }))).toBe(ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id));
    expect(landingOf(person({ seats: [TEAM, seat({ seat: "trainer" })] }))).toBe(ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id));
    expect(landingOf(person({ spieler: { spieler_id: "6890a1b2c3d4e5f607250031" } }))).toBe(ROUTES.areaSpieler.path());
    expect(landingOf(person({ schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607250041" }] }))).toBe(ROUTES.areaSchiedsrichter.path());
    expect(landingOf(person({ admin_tier: "administration" }, true))).toBe(ROUTES.admin.path());
  });

  // The team frame's own season button switches between the two, so a chooser listing the team once a season is a step
  // and a second place for one team.
  it("sends a contact seated on one team in two seasons to that team, in the season its frame takes by standard", () => {
    expect(landingOf(person({ seats: [NEXT_SEASON, TEAM] }))).toBe(ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id));
    // Neither season running, the newest.
    expect(landingOf(person({ seats: [NEXT_SEASON, { ...TEAM, saison_status: "future" }] }))).toBe(
      ROUTES.teamOverview.path(TEAM.team_id, NEXT_SEASON.saison_id),
    );
  });

  it("sends a person holding several places to the chooser", () => {
    expect(landingOf(person({ seats: [TEAM, PAST_TEAM], schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607250041" }] }))).toBe(
      ROUTES.areaRoles.path(),
    );
  });
});

// The harm: the chooser and „Funktion wechseln“ list a team twice, and the account menu marks no place, or the row a
// wrong season's line, on the pages of the season the place does not open on.
describe("a contact's place on a team held in two seasons", () => {
  it("is one, naming each seat once and no season, its parts each season's Übersicht with that season's line", () => {
    const places = placesOf(person({ seats: [NEXT_SEASON, TEAM, seat({ seat: "trainer" })] }));

    expect(places.map(placeOf)).toStrictEqual([
      {
        href: ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id),
        name: { record: TEAM.team_name },
        seats: COPY.team.seatsHeld(["ansprechperson", "trainer"]),
        parts: [
          {
            href: ROUTES.teamOverview.path(TEAM.team_id, NEXT_SEASON.saison_id),
            line: AREA_COPY.team.accountLine({ record: "NEU" }, ["trainer"]),
          },
          {
            href: ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id),
            line: AREA_COPY.team.accountLine({ record: TEAM.team_shorthand }, ["ansprechperson", "trainer"]),
          },
        ],
      },
    ]);
  });
});

// The harm: the landing and the chooser redirect before anything is drawn, so a session owing the administrator's step
// would open a person's pages, and an administrator's would loop back to the sign-in, with nothing said.
describe("whether a session owes a step of the sign-in", () => {
  it("holds for a granted address whose session the administration refuses, and for no other", () => {
    expect(owesSignInStep(person({ admin_tier: "administration" }))).toBe(true);
    expect(owesSignInStep(person({ admin_tier: "administration" }, true))).toBe(false);
    expect(owesSignInStep(person({ seats: [TEAM] }))).toBe(false);
  });
});
