import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { berichtChipText } from "./utils.ts";

import type { FLSpielberichtZustand } from "./schemas.ts";

const chip = (zustand: FLSpielberichtZustand) =>
  berichtChipText({
    spiel_id: "68c1f0a2b3c4d5e6f7a8b9e2",
    zustand,
    ergebnis_vorschlag: { team1_tore: 3, team2_tore: 1, elfmeterschiessen: null, sonderereignis: null },
  });

describe("what an administrator's card says of its report", () => {
  it("names a proposal still to adopt with its score", () => {
    assert.equal(chip("vorgeschlagen"), "Ergebnis vorgeschlagen 3:1");
  });

  /* The triage cards of every section carry the chip, so a state awaiting nobody chipping its card would ask for an
     adoption no press offers: a called-off fixture's panel is read-only. */
  it("says nothing of a report awaiting nobody", () => {
    assert.deepEqual([chip("uebernommen"), chip("abgesagt")], [null, null]);
  });
});
