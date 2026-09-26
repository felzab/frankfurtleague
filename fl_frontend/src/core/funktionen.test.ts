import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { z } from "zod";

import { funktionenOf, grantsAPanel } from "./funktionen.ts";
import { FLSubjektSitzSchema } from "./schemas.ts";

import type { FLSubjektSitz } from "./schemas.ts";
import type { SubjectSession } from "./subject.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

const STATUS = FLSubjektSitzSchema.shape.saison_status;

// Read rather than retyped: the backend's season predicate answers the same rows in its own suite,
// so a status one tier grants and the other refuses fails there as well as here.
const VERDICTS = z
  .array(z.object({ saison_status: STATUS, grants_a_panel: z.boolean() }))
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "grants_a_panel.json"), "utf8")));

const TEAM_ID = "a".repeat(24);

const sitz = (overrides: Partial<FLSubjektSitz> = {}): FLSubjektSitz => ({
  saison_id: "2025/26",
  team_id: TEAM_ID,
  rolle: "trainer",
  team_name: "SV Bornheim 1945",
  saison_status: "active",
  ...overrides,
});

/** A subject holding exactly what a case names, as `getSubjectSession` answers one. */
const subject = ({
  admin = false,
  sitze = [],
  spieler = [],
  schiedsrichter = [],
  unbestaetigt = false,
}: Partial<SubjectSession["subjekt"]> & { admin?: boolean } = {}): SubjectSession => ({
  email: "person@example.org",
  admin: admin,
  subjekt: { sitze: sitze, spieler: spieler, schiedsrichter: schiedsrichter, unbestaetigt: unbestaetigt },
});

describe("which of a subject's seats grant a panel", () => {
  it("grants nothing for a seat on a past season", () => {
    assert.deepEqual(funktionenOf(subject({ sitze: [sitz({ saison_status: "past" })] })).funktionen, []);
  });

  /* Judged seat by seat: a resolver reading one seat's status for all, or keeping every seat once any
     grants, passes each single-seat case. */
  it("keeps the granting seat alone of a past and an active one", () => {
    const { funktionen } = funktionenOf(
      subject({ sitze: [sitz({ saison_id: "2024/25", saison_status: "past" }), sitz({ saison_id: "2025/26", saison_status: "active" })] }),
    );

    assert.deepEqual(
      funktionen.map((funktion) => (funktion.art === "kontakt" ? funktion.saison_id : null)),
      ["2025/26"],
    );
  });

  for (const status of ["active", "future"] as const) {
    it(`grants one Funktion for a seat whose season is ${status}, carrying its team's name and its season's status`, () => {
      assert.deepEqual(funktionenOf(subject({ sitze: [sitz({ saison_status: status })] })).funktionen, [
        { art: "kontakt", rolle: "trainer", team_id: TEAM_ID, saison_id: "2025/26", team_name: "SV Bornheim 1945", saison_status: status },
      ]);
    });
  }

  /* Per seat and never per team: a resolver collapsing one junction row's two seats into one drops
     the second seat's `rolle`. */
  it("answers two seats on one team as two Funktionen naming that one team", () => {
    const { funktionen } = funktionenOf(subject({ sitze: [sitz({ rolle: "trainer" }), sitz({ rolle: "ansprechperson" })] }));

    assert.equal(funktionen.length, 2);
    assert.deepEqual(new Set(funktionen.map((funktion) => (funktion.art === "kontakt" ? funktion.team_id : null))), new Set([TEAM_ID]));
    assert.deepEqual(
      new Set(funktionen.map((funktion) => (funktion.art === "kontakt" ? funktion.rolle : null))),
      new Set(["trainer", "ansprechperson"]),
    );
  });

  it("answers one team's seats in two granting seasons as two Funktionen", () => {
    const { funktionen } = funktionenOf(
      subject({ sitze: [sitz({ saison_id: "2025/26" }), sitz({ saison_id: "2026/27", saison_status: "future" })] }),
    );

    assert.deepEqual(
      funktionen.map((funktion) => (funktion.art === "kontakt" ? funktion.saison_id : null)),
      ["2025/26", "2026/27"],
    );
  });
});

describe("the Funktionen no season narrows", () => {
  it("passes every pupil and referee row through", () => {
    const { funktionen } = funktionenOf(
      subject({ spieler: [{ spieler_id: "b".repeat(24) }], schiedsrichter: [{ schiedsrichter_id: "c".repeat(24) }] }),
    );

    assert.deepEqual(funktionen, [
      { art: "spieler", spieler_id: "b".repeat(24) },
      { art: "schiedsrichter", schiedsrichter_id: "c".repeat(24) },
    ]);
  });

  it("answers the administrator's verdict as the administration Funktion, and nothing without it", () => {
    assert.deepEqual(funktionenOf(subject({ admin: true })).funktionen, [{ art: "administration" }]);
    assert.deepEqual(funktionenOf(subject({ admin: false })).funktionen, []);
  });
});

describe("the pending flag", () => {
  /* Both values: a resolver answering a constant passes whichever single one a case asked about. */
  it("passes the lookup's flag through unchanged", () => {
    assert.equal(funktionenOf(subject({ unbestaetigt: true })).unbestaetigt, true);
    assert.equal(funktionenOf(subject({ unbestaetigt: false })).unbestaetigt, false);
  });
});

describe("the season predicate against the backend's", () => {
  /* The table's statuses against the enum's: a status added to one and not the other is a status
     nobody decided for, and the per-row cases below would never reach it. */
  it("reads one row per status the mirror declares, and no other", () => {
    const statuses = VERDICTS.map((row) => row.saison_status);

    assert.equal(new Set(statuses).size, statuses.length, "the shared table decides one status twice");
    assert.deepEqual([...statuses].sort(), [...STATUS.options].sort());
  });

  for (const { saison_status, grants_a_panel: grants } of VERDICTS) {
    it(`answers a ${saison_status} season as the backend does`, () => {
      assert.equal(grantsAPanel(saison_status), grants);
    });
  }
});
