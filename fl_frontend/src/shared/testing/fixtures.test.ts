import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { side, spielFields } from "./fixtures.ts";

/* Reached with `await import` rather than a static import: a module under `shared` may not name a
   feature slice, which is the whole reason these fields are typed structurally. */
const { FLSpielSchema, FLSpielTeamFieldJoinedSchema } = await import("@/features/spiele/schemas.ts");

describe("the fixture every fixture-reading case starts from", () => {
  /* Both directions, because zod strips an unknown key in silence: a field renamed on the schema
     side would otherwise leave this shape spelling the old name and the parse filling neither. */
  it("spells exactly the fields the schema declares", () => {
    assert.deepEqual(Object.keys(spielFields()).sort(), Object.keys(FLSpielSchema.shape).sort());
    assert.deepEqual(Object.keys(side("x")).sort(), Object.keys(FLSpielTeamFieldJoinedSchema.shape).sort());
  });

  it("parses, and lands in no category of its own", () => {
    const spiel = FLSpielSchema.parse(spielFields());

    assert.equal(spiel.ergebnis, null);
    assert.equal(spiel.datum, null);
    assert.equal(spiel.sonderereignis, null);
    assert.equal(spiel.saison_phase, "gruppenphase");
    assert.ok(spiel.team1 !== null && spiel.team2 !== null, "a side is unknown, so a case about an empty slot proves nothing");
  });

  it("takes an override over each default, on the fixture and on a side alike", () => {
    const spiel = FLSpielSchema.parse(spielFields({ ergebnis: "3:1", team2: side("6890a1b2c3d4e5f607182999", { tore: 1, shorthand: "XX" }) }));

    assert.equal(spiel.ergebnis, "3:1");
    assert.equal(spiel.team2?.tore, 1);
    assert.equal(spiel.team2?.shorthand, "XX");
    assert.equal(spiel.team2?.name, "SV Beispiel", "an override replaced a field it was not given");
  });
});
