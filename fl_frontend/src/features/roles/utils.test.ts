import { person, seat } from "@/test-support/subjectFixtures";
import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes";

import { landingTargetOf, owesSignInStep, placesOf } from "./utils";

import type { SubjectSession } from "@/core/subject";

const TEAM = seat();
/** Another club's seat on a season that is over, which opens nothing. */
const PAST_TEAM = seat({ team_id: "6890a1b2c3d4e5f607250022", saison_id: "2425", saison_status: "past" });

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
    expect(landingOf(person({ seats: [TEAM, seat({ rolle: "trainer" })] }))).toBe(ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id));
    expect(landingOf(person({ spieler: [{ spieler_id: "6890a1b2c3d4e5f607250031" }] }))).toBe(ROUTES.areaSpieler.path());
    expect(landingOf(person({ schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607250041" }] }))).toBe(ROUTES.areaSchiedsrichter.path());
    expect(landingOf(person({ admin_tier: "administration" }, true))).toBe(ROUTES.admin.path());
  });

  it("sends a person holding several places to the chooser", () => {
    expect(landingOf(person({ seats: [TEAM, PAST_TEAM], schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607250041" }] }))).toBe(
      ROUTES.areaRoles.path(),
    );
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
