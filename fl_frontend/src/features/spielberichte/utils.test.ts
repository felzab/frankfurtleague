import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { berichtChip, mapSpielberichtRefusal } from "./utils.ts";

import type { FLSpielberichtZustand } from "./schemas.ts";

const chip = (zustand: FLSpielberichtZustand) =>
  berichtChip({
    spiel_id: "68c1f0a2b3c4d5e6f7a8b9e2",
    zustand,
    ergebnis_vorschlag: { team1_tore: 3, team2_tore: 1, elfmeterschiessen: null, sonderereignis: null },
  });

describe("what an administrator's card says of its report", () => {
  it("names a proposal still to adopt with its score", () => {
    assert.deepEqual(chip("vorgeschlagen"), { text: "Ergebnis vorgeschlagen 3:1", tone: "info" });
  });

  /* `abweichend` is also a first report beside a result typed by hand, which nobody changed: „geändert“ would be false. */
  it("names a report the result does not stand on as not adopted, in the panel's warning tone", () => {
    assert.deepEqual(chip("abweichend"), { text: "Bericht nicht übernommen 3:1", tone: "warning" });
  });

  /* The triage cards of every section carry the chip, so a state awaiting nobody chipping its card would ask for an
     adoption no press offers: a called-off fixture's panel is read-only. */
  it("says nothing of a report awaiting nobody", () => {
    assert.deepEqual([chip("uebernommen"), chip("abgesagt")], [null, null]);
  });

  /* Proposed for other clubs than the fixture fields now: its score beside the card's clubs would read as theirs. */
  it("names a report about other teams without its score", () => {
    assert.deepEqual(chip("teams_geaendert"), { text: "Bericht zu anderen Teams", tone: "warning" });
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
