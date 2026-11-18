import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { person, seat, SEAT } from "@/test-support/subjectFixtures";

import { FLSaisonStatus } from "./generated/client/types";
import { grantsAPanel, rolesOf, seatsAt } from "./roles";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const STATUS = z.enum(FLSaisonStatus);

// Read rather than retyped: the backend's own suite holds `grants_a_panel` to the same table, so a status either tier
// decides otherwise fails that tier's suite.
const VERDICTS = z
  .array(z.object({ saison_status: STATUS, grants_a_panel: z.boolean() }))
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "grants_a_panel.json"), "utf8")));

describe("which of a subject's seats grant a panel", () => {
  /* Judged seat by seat: a resolver reading one seat's status for all, or keeping every seat once any
     grants, passes each single-seat case. */
  it("keeps the granting seat alone of a past and an active one", () => {
    const { roles } = rolesOf(
      person({ seats: [seat({ saison_id: "2024/25", saison_status: "past" }), seat({ saison_id: "2025/26", saison_status: "active" })] }),
    );

    expect(roles.map((role) => (role.kind === "kontakt" ? role.saison_id : null))).toStrictEqual(["2025/26"]);
  });

  /* Per seat and never per team: a resolver collapsing one junction row's two seats into one drops
     the second seat. */
  it("answers two seats on one team as two Funktionen naming that one team", () => {
    const { roles } = rolesOf(person({ seats: [seat({ seat: "trainer" }), seat({ seat: "ansprechperson" })] }));

    expect(roles.length).toBe(2);
    expect(new Set(roles.map((role) => (role.kind === "kontakt" ? role.team_id : null)))).toStrictEqual(new Set([SEAT.team_id]));
    expect(new Set(roles.map((role) => (role.kind === "kontakt" ? role.seat : null)))).toStrictEqual(new Set(["trainer", "ansprechperson"]));
  });
});

describe("the seats at a team page's address", () => {
  /* A seat on the same team next season, and one on another team this season, are seats still, and open nothing at
     this address: a test of the kind alone, or of one segment, lets either in. */
  it("answers the seat on this team in this season alone", () => {
    const here = seat();
    const { roles } = rolesOf(
      person({
        seats: [seat({ saison_id: "2627", saison_status: "future" }), seat({ team_id: "6890a1b2c3d4e5f607250099" }), here],
        spieler: [{ spieler_id: "6890a1b2c3d4e5f607250077" }],
      }),
    );

    expect(seatsAt(roles, here.team_id, here.saison_id).map(({ team_id, saison_id }) => ({ team_id, saison_id }))).toStrictEqual([
      { team_id: here.team_id, saison_id: here.saison_id },
    ]);
  });
});

describe("the Funktionen no season narrows", () => {
  it("answers the administrator's verdict as the administration Funktion, and nothing without it", () => {
    expect(rolesOf(person({}, true)).roles).toStrictEqual([{ kind: "administration" }]);
    expect(rolesOf(person()).roles).toStrictEqual([]);
  });
});

describe("the pending flag", () => {
  /* Both values: a resolver answering a constant passes whichever single one a case asked about. */
  it("passes the lookup's flag through unchanged", () => {
    expect(rolesOf(person({ unconfirmed: true })).unconfirmed).toBe(true);
    expect(rolesOf(person({ unconfirmed: false })).unconfirmed).toBe(false);
  });
});

describe("the season predicate against the backend's", () => {
  /* The table's statuses against the enum's: a status added to one and not the other is a status
     nobody decided for, and the per-row cases below would never reach it. */
  it("reads one row per status the mirror declares, and no other", () => {
    const statuses = VERDICTS.map((row) => row.saison_status);

    expect(new Set(statuses).size, "the shared table decides one status twice").toBe(statuses.length);
    expect([...statuses].sort()).toStrictEqual([...STATUS.options].sort());
  });

  for (const { saison_status, grants_a_panel: grants } of VERDICTS) {
    it(`answers a ${saison_status} season as the backend does`, () => {
      expect(grantsAPanel(saison_status)).toBe(grants);
    });
  }
});
