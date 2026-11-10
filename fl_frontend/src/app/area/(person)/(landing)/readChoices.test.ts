import { person, seat } from "@/test-support/subjectFixtures";
import { describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes";

import { readChoices } from "./readChoices";

import type { SubjectSession } from "@/core/subject";

/** The person each case's session read answers. */
const session = vi.hoisted(() => ({ subject: null as SubjectSession | null }));
vi.mock("@/core/subject", () => ({ getSubjectSession: () => Promise.resolve(session.subject) }));

/** Where the landing sends `subject`, as Next's redirect names it in what it throws; `null` where it lists their places. */
async function landingOf(subject: SubjectSession): Promise<string | null> {
  session.subject = subject;
  const thrown: unknown = await readChoices().then(
    () => null,
    (error: unknown) => error,
  );
  if (thrown === null) return null;
  const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";
  const [kind, , address] = digest.split(";");
  if (kind !== "NEXT_REDIRECT") throw thrown;
  return address ?? null;
}

const TEAM = seat();
/** Another club's seat on a season that is over, which opens nothing. */
const PAST_TEAM = seat({ team_id: "6890a1b2c3d4e5f607250022", saison_id: "2425", saison_status: "past" });

// The harm: the landing redirects before anything is drawn, so a person sent into a place they do not hold, or
// shown a chooser of one card, sees only where they arrive.
describe("the landing", () => {
  it("sends a person holding one place on to that place, whatever its kind", async () => {
    expect(await landingOf(person({ seats: [TEAM] }))).toBe(ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id));
    expect(await landingOf(person({ seats: [TEAM, seat({ rolle: "trainer" })] }))).toBe(ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id));
    expect(await landingOf(person({ spieler: [{ spieler_id: "6890a1b2c3d4e5f607250031" }] }))).toBe(ROUTES.areaSpieler.path());
    expect(await landingOf(person({ schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607250041" }] }))).toBe(
      ROUTES.areaSchiedsrichter.path(),
    );
    expect(await landingOf(person({ admin_tier: "administration" }, true))).toBe(ROUTES.admin.path());
  });

  it("sends a person to no place they do not hold", async () => {
    expect(await landingOf(person({ seats: [PAST_TEAM] }))).toBe(ROUTES.account.path());
    expect(await landingOf(person())).toBe(ROUTES.account.path());
    // A grant whose session the administrator's lane refuses owes its sign-in step, not the administration.
    expect(await landingOf(person({ admin_tier: "administration" }))).toBe(ROUTES.signInLanding.path());
  });

  it("lists for a person holding several only the places they hold", async () => {
    session.subject = person({ seats: [TEAM, PAST_TEAM], schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607250041" }] });

    expect((await readChoices()).choices.map((choice) => choice.href)).toEqual([
      ROUTES.teamOverview.path(TEAM.team_id, TEAM.saison_id),
      ROUTES.areaSchiedsrichter.path(),
    ]);
  });
});
