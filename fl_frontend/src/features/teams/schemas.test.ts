import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLPatchTeamResponseSchema, FLReplaceSaisonTeamResponseSchema, FLSaisonTeamResponseSchema } from "./schemas";

/**
 * What `fl_frontend/src/core/apiContract.test.ts` cannot reach: it compares presence, required,
 * nullable, type and enum, so a bound that disagrees with the backend's passes it green.
 */
const pathsRefused = (
  schema: typeof FLPatchTeamResponseSchema | typeof FLReplaceSaisonTeamResponseSchema | typeof FLSaisonTeamResponseSchema,
  value: unknown,
): string[] => {
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

const replacement = (overrides: Record<string, unknown> = {}) => ({
  acknowledged: 1,
  saison_id: "2026",
  outgoing_team_id: "0123456789abcdef01234567",
  incoming_team_id: "89abcdef0123456701234567",
  gruppe: "A",
  name: "SC Riederwald",
  shorthand: "RW",
  fanned_out_to_spiele: 3,
  retired_squad_rows: 11,
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

describe("FLReplaceSaisonTeamResponseSchema", () => {
  it("takes a row handed over with its fixtures, carrying the identity reseeded from the incoming club", () => {
    assert.deepEqual(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement()), []);
  });

  it("holds the reseeded identity to the same bounds a junction row's own copy is held to", () => {
    assert.deepEqual(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement({ shorthand: "RWD" })), ["shorthand"]);
    assert.deepEqual(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement({ name: "" })), ["name"]);
  });

  it("refuses a negative fan-out, a figure no `modified_count` can report", () => {
    assert.deepEqual(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement({ fanned_out_to_spiele: -1 })), ["fanned_out_to_spiele"]);
  });

  it("requires the fan-out, so it cannot be read as zero when the endpoint never sent it", () => {
    const { fanned_out_to_spiele: _count, ...withoutCount } = replacement();

    assert.deepEqual(pathsRefused(FLReplaceSaisonTeamResponseSchema, withoutCount), ["fanned_out_to_spiele"]);
  });

  /* Its own required figure: a squad retirement that reported nothing would read as zero, and the
     save message would tell an admin no player was touched while eleven were. */
  it("requires the retired squad count, which is not derivable from the fixture fan-out", () => {
    const { retired_squad_rows: _retired, ...withoutCount } = replacement();

    assert.deepEqual(pathsRefused(FLReplaceSaisonTeamResponseSchema, withoutCount), ["retired_squad_rows"]);
    assert.deepEqual(pathsRefused(FLReplaceSaisonTeamResponseSchema, replacement({ retired_squad_rows: -1 })), ["retired_squad_rows"]);
  });

  /* A replacement always clears the austritt, so the response states none. Parsed away rather than
     refused, which is what stops a caller reading a field the endpoint never decided. */
  it("drops an austritt an over-eager caller reads for, rather than carrying one", () => {
    const parsed = FLReplaceSaisonTeamResponseSchema.parse(replacement({ austritt: { type: "rueckzug", grund: "x", datum: "2026-03-12" } }));

    assert.equal("austritt" in parsed, false);
  });
});
