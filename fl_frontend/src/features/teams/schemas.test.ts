import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLPatchTeamResponseSchema, FLSaisonTeamResponseSchema } from "./schemas";

/**
 * What `fl_frontend/src/core/apiContract.test.ts` cannot reach: it compares presence, required,
 * nullable, type and enum, so a bound that disagrees with the backend's passes it green.
 */
const pathsRefused = (schema: typeof FLPatchTeamResponseSchema | typeof FLSaisonTeamResponseSchema, value: unknown): string[] => {
  const result = schema.safeParse(value);

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

const saisonTeam = (overrides: Record<string, unknown> = {}) => ({
  acknowledged: 1,
  saison_id: "2026",
  team_id: "0123456789abcdef01234567",
  gruppe: "A",
  austritt: null,
  name: "SC Riederwald",
  shorthand: "RW",
  ...overrides,
});

const patchTeam = (overrides: Record<string, unknown> = {}) => ({
  acknowledged: 1,
  updated_document: {
    id: "0123456789abcdef01234567",
    name: "SC Riederwald",
    shorthand: "RW",
    description: "",
    full_name: "Sportclub Riederwald 1927",
    website_url: "https://example.org",
    address: { strasse: "Hanauer Landstraße", hausnummer: "12a", plz: "60314", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
    inactive_since: null,
  },
  fanned_out_to_spiele: 0,
  fanned_out_to_saison_teams: 0,
  ...overrides,
});

describe("FLSaisonTeamResponseSchema", () => {
  it("takes a junction row carrying the season's copy of the club identity", () => {
    assert.deepEqual(pathsRefused(FLSaisonTeamResponseSchema, saisonTeam()), []);
  });

  it("holds the shorthand to exactly two characters, as `TEAM_SHORTHAND_LENGTH` does", () => {
    for (const shorthand of ["", "R", "RWD"]) {
      assert.deepEqual(pathsRefused(FLSaisonTeamResponseSchema, saisonTeam({ shorthand })), ["shorthand"], `expected "${shorthand}" refused`);
    }
  });

  it("refuses an empty name, which no club document can hold", () => {
    assert.deepEqual(pathsRefused(FLSaisonTeamResponseSchema, saisonTeam({ name: "" })), ["name"]);
  });

  it("requires both, so a row seeded without them is a malformed response rather than a partial one", () => {
    const { name: _name, shorthand: _shorthand, ...withoutIdentity } = saisonTeam();

    assert.deepEqual(pathsRefused(FLSaisonTeamResponseSchema, withoutIdentity), ["name", "shorthand"]);
  });
});

describe("FLPatchTeamResponseSchema", () => {
  it("takes a rename that reached no junction row, the answer for a club whose every season is past", () => {
    assert.deepEqual(pathsRefused(FLPatchTeamResponseSchema, patchTeam()), []);
  });

  it("refuses a negative junction count, a figure no `modified_count` can report", () => {
    assert.deepEqual(pathsRefused(FLPatchTeamResponseSchema, patchTeam({ fanned_out_to_saison_teams: -1 })), ["fanned_out_to_saison_teams"]);
  });

  it("requires the junction count, so it cannot be read as zero when the endpoint never sent it", () => {
    const { fanned_out_to_saison_teams: _count, ...withoutCount } = patchTeam();

    assert.deepEqual(pathsRefused(FLPatchTeamResponseSchema, withoutCount), ["fanned_out_to_saison_teams"]);
  });
});
