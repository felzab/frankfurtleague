import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import type { Funktion } from "@/core/funktionen.ts";

/* The real table and a second row after it: with the landing alone, "every entry" and "the landing
   only" are one list, and no case could tell a seat rule narrowing a Trainer to the landing. */
const tableDouble = (real: string) => `import * as real from ${JSON.stringify(real)};
export * from ${JSON.stringify(real)};
export const TEAM_SIDEMENU_ENTRIES = [...real.TEAM_SIDEMENU_ENTRIES, { ...real.TEAM_SIDEMENU_ENTRIES[0], id: "probe-seite", label: "Probe" }];`;

registerHooks({
  load(url, context, nextLoad) {
    // The query keeps the real module's own url from matching here again.
    if (url.endsWith("/src/features/funktionen/constants.ts"))
      return { format: "module", source: tableDouble(`${url}?real`), shortCircuit: true };
    return nextLoad(url, context);
  },
});

/* Reached with `await import` and never a static import beside the harness: the icon package's bare
   `./x` imports need the resolver the harness registers as it evaluates. */
await import("@/shared/testing/renderTest.ts");
const { TEAM_SIDEMENU_ENTRIES } = await import("./constants.ts");
const { teamStructureFor } = await import("./teamStructure.ts");
const { seatsAt } = await import("./teamSeats.ts");

const TEAM_A = "6890a1b2c3d4e5f607250011";
const TEAM_B = "6890a1b2c3d4e5f607250012";

const seat = (fields: Partial<Extract<Funktion, { art: "kontakt" }>> = {}): Funktion => ({
  art: "kontakt",
  rolle: "ansprechperson",
  team_id: TEAM_A,
  saison_id: "2526",
  team_name: "Goethe-Gymnasium",
  saison_status: "active",
  ...fields,
});

/** The ids the team shell lists for a person holding `funktionen`, standing at one team and season. */
const listedAt = (funktionen: Funktion[], teamId: string, saisonId: string): string[] =>
  teamStructureFor(seatsAt(funktionen, teamId, saisonId)).flatMap((group) => group.sub_options.map((option) => option.id));

const EVERY_ENTRY = TEAM_SIDEMENU_ENTRIES.map((entry) => entry.id);

describe("what the team shell lists", () => {
  /* First: a double that never took would leave every case below comparing one-row lists. */
  it("reads a table holding more than the landing", () => {
    assert.ok(EVERY_ENTRY.length > 1, `the table holds ${String(EVERY_ENTRY.length)} entry, so a Trainer's landing-only list would pass`);
  });

  /* The control for the refusals below: a seat at the address lists every entry there is. */
  it("lists every entry for a seat on the address's team and season", () => {
    assert.deepEqual(listedAt([seat()], TEAM_A, "2526"), EVERY_ENTRY);
  });

  it("lists nothing on another team for a seat on one team", () => {
    assert.deepEqual(listedAt([seat()], TEAM_B, "2526"), []);
  });

  /* The same team in another season is another panel: its squad and its registrations are that season's. */
  it("lists nothing in another season for a seat in one season", () => {
    assert.deepEqual(listedAt([seat()], TEAM_A, "2627"), []);
  });

  /* One seat set and one guard across the panel: whatever an Ansprechperson reaches, a Trainer-only
     seat reaches too, and a Stellvertretung. */
  it("lists the same entries for a Trainer-only seat as for an Ansprechperson's", () => {
    for (const rolle of ["ansprechperson", "trainer", "stellvertretung"] as const) {
      assert.deepEqual(listedAt([seat({ rolle: rolle })], TEAM_A, "2526"), EVERY_ENTRY, `a ${rolle} seat lists less than every entry`);
    }
  });

  /* A pupil's row or a referee's is no seat on any team, even one carrying the address's own team and
     season, as a squad row naming its team would: only the `art` tells it from a seat. */
  it("lists nothing for a Funktion that is no seat", () => {
    const address = { team_id: TEAM_A, saison_id: "2526", rolle: "ansprechperson" };
    const spieler = { art: "spieler" as const, spieler_id: TEAM_A, ...address };
    const schiedsrichter = { art: "schiedsrichter" as const, schiedsrichter_id: TEAM_A, ...address };
    const administration = { art: "administration" as const, ...address };
    const funktionen: Funktion[] = [spieler, schiedsrichter, administration];

    assert.deepEqual(listedAt(funktionen, TEAM_A, "2526"), []);
  });
});
