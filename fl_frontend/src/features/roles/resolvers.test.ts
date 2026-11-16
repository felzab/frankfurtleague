import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { SEAT, seat } from "@/test-support/subjectFixtures";
import { thrownRedirect } from "@/test-support/thrownRedirect";
import { describe, expect, it } from "vitest";

import { APIBadStatusError } from "@/core/errors";
import { ROUTES } from "@/core/routes";

/** The same team's seat for next season, which grants a panel as this season's would. */
const NEXT_SEASON = seat({ saison_id: "2627", saison_status: "future" });

// No answer of its own: the seats are read off the session's lookup alone.
serveBackend();
signedInRequest({ email: "pia@example.org", records: { seats: [NEXT_SEASON] } });
// Imported after the doubles above, which reach only the modules imported after them.
const { readAsRoleHolder, requireTeamSeats } = await import("./resolvers");

// The harm: a pupil or a referee whose Funktion went between the page's check and the backend's meets the error card,
// which says something broke, where every other place of theirs sends them on to the landing.
describe("a person place's read the backend refuses for a Funktion gone", () => {
  it("sends the person on to the landing", async () => {
    const gone = new APIBadStatusError({ message: "refused", statusCode: 409, serverErrorCode: "role_not_held", traceId: "0" });
    const redirect = await thrownRedirect(readAsRoleHolder("spieler", () => Promise.reject(gone)));

    expect([redirect.type, redirect.address]).toStrictEqual(["replace", ROUTES.area.path()]);
  });
});

// The harm: a seat on a team in another season would draw this season's team pages around the person, whose every
// read the backend then refuses.
describe("a team page's seats", () => {
  const seatsIn = (saison: string) =>
    requireTeamSeats(Promise.resolve({ team: SEAT.team_id, saison }), ({ team, saison: at }) => `/area/team/${team}/${at}`);

  it("are the seats held in the address's season alone, none for another season's seat on the team", async () => {
    await expect(seatsIn(SEAT.saison_id), "a seat for next season opened this season's page").rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect((await seatsIn(NEXT_SEASON.saison_id)).map(({ saison_id }) => saison_id)).toStrictEqual([NEXT_SEASON.saison_id]);
  });
});
