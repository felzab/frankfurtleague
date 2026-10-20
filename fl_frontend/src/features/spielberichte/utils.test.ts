import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { berichtChipText, mapSpielberichtRefusal } from "./utils.ts";

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

describe("a write composed on a report that has changed since", () => {
  /* The reload draws the form anew, so each reader is told to enter the change again, and who else writes the report. */
  it("tells each reader to reload and enter the change again, naming the other writer", () => {
    const schiedsrichter = mapSpielberichtRefusal(refusedOn("PUT /spielberichte/{spiel_id}/bericht", "REQ-BERICHT-006"), "schiedsrichter");
    const admin = mapSpielberichtRefusal(refusedOn("PATCH /spielberichte/{spiel_id}", "REQ-BERICHT-006"), "admin");

    for (const answer of [schiedsrichter, admin]) {
      assert.match(
        answer?.error ?? "",
        /^Der Spielbericht wurde inzwischen geändert.*Lade die Seite neu und trage Deine Änderung dort erneut ein\.$/,
      );
    }
    assert.match(schiedsrichter?.error ?? "", /von der Verwaltung/);
    assert.match(admin?.error ?? "", /von der Schiedsrichterin oder dem Schiedsrichter/);
  });
});
