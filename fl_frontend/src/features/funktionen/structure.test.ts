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
    const ansprechperson = listedAt([seat({ rolle: "ansprechperson" })], TEAM_A, "2526");

    assert.deepEqual(listedAt([seat({ rolle: "trainer" })], TEAM_A, "2526"), ansprechperson);
    assert.deepEqual(listedAt([seat({ rolle: "stellvertretung" })], TEAM_A, "2526"), ansprechperson);
  });

  /* A pupil's row or a referee's is no seat on any team, whatever id it carries. */
  it("lists nothing for a Funktion that is no seat", () => {
    const funktionen: Funktion[] = [
      { art: "spieler", spieler_id: TEAM_A },
      { art: "schiedsrichter", schiedsrichter_id: TEAM_A },
      { art: "administration" },
    ];

    assert.deepEqual(listedAt(funktionen, TEAM_A, "2526"), []);
  });
});
