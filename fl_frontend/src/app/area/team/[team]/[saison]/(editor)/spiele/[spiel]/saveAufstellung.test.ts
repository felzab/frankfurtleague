import { describe, expect, it } from "vitest";

import { serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { seat } from "@/test-support/subjectFixtures";

import type { FLAufstellungResponse } from "@/core/generated/client/types";

const TEAM = "6890a1b2c3d4e5f607250011";
const OTHER_TEAM = "6890a1b2c3d4e5f607250012";
const SPIEL = "6890a1b2c3d4e5f607250021";

/** The stored line-up the save reads again, naming nobody: the body it merges is the administration's save's case. */
const STORED: FLAufstellungResponse = {
  spiel: {
    spiel_id: SPIEL,
    saison_id: "2027",
    date: "2026-11-14",
    time: "16:00:00",
    team1: null,
    team2: null,
    saison_phase: "gruppenphase",
    spieltag_position: 2,
    count_spieltage_in_phase: 5,
    for_third_place: false,
    sonderereignis: null,
  },
  saison_status: "active",
  team_id: TEAM,
  kader: [],
  named: [],
  spieler: [],
  version: 3,
  marks: null,
};

/** The seat holder's address of the line-up; the administration's ends in `/admin`. */
const LINEUP = `/aufstellungen/spiele/${SPIEL}/teams/${TEAM}`;

// The merge's read and the write, each answered only at the line-up of the match and the club the case names: a save
// reaching for another club's line-up, or for the administration's address, goes unanswered and fails the case.
const backend = serveBackend(({ method, path }) => {
  if (path !== LINEUP) return undefined;
  if (method === "GET") return STORED;
  return method === "PUT" ? { version: 4 } : undefined;
});
// A person holding seats on two clubs of the season, either of which the backend admits, so only the club the save
// names keeps it to the line-up it was pressed for.
signedInRequest({
  email: "pia@example.org",
  records: { seats: [seat({ team_id: TEAM, saison_id: "2027" }), seat({ team_id: OTHER_TEAM, saison_id: "2027" })] },
});

const { saveAufstellung } = await import("./saveAufstellung");

describe("a line-up's save", () => {
  // Sent for another club the person holds a seat on, the write would change a line-up they were not editing, and sent
  // at the administration's address it would be refused to a seat holder: either way the editor's save goes astray.
  it("reads and writes the line-up of the match and the club it names, as a seat of that club", async () => {
    const answer = await saveAufstellung({ team_id: TEAM, id: SPIEL, version: 3, changes: {} });

    expect(backend.sent.map(({ path, method }) => ({ path, method }))).toStrictEqual([
      // The merge reads the line-up of the same match and club it writes.
      { path: LINEUP, method: "GET" },
      { path: LINEUP, method: "PUT" },
    ]);
    expect(answer).toStrictEqual({ ok: true, value: 4 });
  });
});
