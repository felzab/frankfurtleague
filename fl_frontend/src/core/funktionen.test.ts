import { readFileSync } from "node:fs";
import path from "node:path";

import { person, seat, SEAT } from "@/test-support/subjectFixtures.ts";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { grantsAPanel, rolesOf } from "./funktionen.ts";
import { FLSaisonStatus } from "./generated/client/types.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const STATUS = z.enum(FLSaisonStatus);

// Read rather than retyped: the backend's season predicate answers the same rows in its own suite,
// so a status one tier grants and the other refuses fails there as well as here.
const VERDICTS = z
  .array(z.object({ saison_status: STATUS, grants_a_panel: z.boolean() }))
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "grants_a_panel.json"), "utf8")));

describe("which of a subject's seats grant a panel", () => {
  it("grants nothing for a seat on a past season", () => {
    expect(rolesOf(person({ sitze: [seat({ saison_status: "past" })] })).roles).toStrictEqual([]);
  });

  /* Judged seat by seat: a resolver reading one seat's status for all, or keeping every seat once any
     grants, passes each single-seat case. */
  it("keeps the granting seat alone of a past and an active one", () => {
    const { roles } = rolesOf(
      person({ sitze: [seat({ saison_id: "2024/25", saison_status: "past" }), seat({ saison_id: "2025/26", saison_status: "active" })] }),
    );

    expect(roles.map((role) => (role.art === "kontakt" ? role.saison_id : null))).toStrictEqual(["2025/26"]);
  });

  for (const status of ["active", "future"] as const) {
    it(`grants one Funktion for a seat whose season is ${status}, carrying its team's name and its season's status`, () => {
      expect(rolesOf(person({ sitze: [seat({ saison_status: status })] })).roles).toStrictEqual([
        {
          art: "kontakt",
          rolle: "ansprechperson",
          team_id: SEAT.team_id,
          saison_id: "2526",
          team_name: "Goethe-Gymnasium",
          saison_status: status,
        },
      ]);
    });
  }

  /* Per seat and never per team: a resolver collapsing one junction row's two seats into one drops
     the second seat's `rolle`. */
  it("answers two seats on one team as two Funktionen naming that one team", () => {
    const { roles } = rolesOf(person({ sitze: [seat({ rolle: "trainer" }), seat({ rolle: "ansprechperson" })] }));

    expect(roles.length).toBe(2);
    expect(new Set(roles.map((role) => (role.art === "kontakt" ? role.team_id : null)))).toStrictEqual(new Set([SEAT.team_id]));
    expect(new Set(roles.map((role) => (role.art === "kontakt" ? role.rolle : null)))).toStrictEqual(new Set(["trainer", "ansprechperson"]));
  });

  it("answers one team's seats in two granting seasons as two Funktionen", () => {
    const { roles } = rolesOf(person({ sitze: [seat({ saison_id: "2025/26" }), seat({ saison_id: "2026/27", saison_status: "future" })] }));

    expect(roles.map((role) => (role.art === "kontakt" ? role.saison_id : null))).toStrictEqual(["2025/26", "2026/27"]);
  });
});

describe("the Funktionen no season narrows", () => {
  it("passes every pupil and referee row through", () => {
    const { roles } = rolesOf(person({ spieler: [{ spieler_id: "b".repeat(24) }], schiedsrichter: [{ schiedsrichter_id: "c".repeat(24) }] }));

    expect(roles).toStrictEqual([
      { art: "spieler", spieler_id: "b".repeat(24) },
      { art: "schiedsrichter", schiedsrichter_id: "c".repeat(24) },
    ]);
  });

  it("answers the administrator's verdict as the administration Funktion, and nothing without it", () => {
    expect(rolesOf(person({}, true)).roles).toStrictEqual([{ art: "administration" }]);
    expect(rolesOf(person()).roles).toStrictEqual([]);
  });
});

describe("the pending flag", () => {
  /* Both values: a resolver answering a constant passes whichever single one a case asked about. */
  it("passes the lookup's flag through unchanged", () => {
    expect(rolesOf(person({ unbestaetigt: true })).unbestaetigt).toBe(true);
    expect(rolesOf(person({ unbestaetigt: false })).unbestaetigt).toBe(false);
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
