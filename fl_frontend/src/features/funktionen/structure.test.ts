import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Funktion } from "@/core/funktionen.ts";

/* Reached with `await import` and never a static import beside the harness: the icon package's bare
   `./x` imports need the resolver the harness registers as it evaluates. */
await import("@/shared/testing/renderTest.ts");
const { TEAM_SIDEMENU_ENTRIES, teamStructureFor } = await import("./constants.ts");
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

  /* Named literally rather than read off the table, whose own entries the case above compares against:
     with the squad's entry gone from the table, that case still passes. */
  it("lists the squad for every seat, a Trainer-only seat's included", () => {
    for (const rolle of ["ansprechperson", "trainer", "stellvertretung"] as const) {
      assert.ok(listedAt([seat({ rolle: rolle })], TEAM_A, "2526").includes("kader"), `a ${rolle} seat lists no squad`);
    }
  });

  // Named literally for the squad case's reason above.
  it("lists the registrations page for every seat, a Trainer-only seat included", () => {
    for (const rolle of ["ansprechperson", "trainer", "stellvertretung"] as const) {
      assert.ok(
        listedAt([seat({ rolle: rolle })], TEAM_A, "2526").includes("registrierungen"),
        `a ${rolle} seat is not shown the registrations`,
      );
    }
  });

  /* A pupil's row or a referee's is no seat on any team, even one carrying the address's own team and
     season, which none carries today and a later Funktion may: only the `art` tells it from a seat. */
  it("lists nothing for a Funktion that is no seat", () => {
    const address = { team_id: TEAM_A, saison_id: "2526", rolle: "ansprechperson" };
    const spieler = { art: "spieler" as const, spieler_id: TEAM_A, ...address };
    const schiedsrichter = { art: "schiedsrichter" as const, schiedsrichter_id: TEAM_A, ...address };
    const administration = { art: "administration" as const, ...address };
    const funktionen: Funktion[] = [spieler, schiedsrichter, administration];

    assert.deepEqual(listedAt(funktionen, TEAM_A, "2526"), []);
  });
});
