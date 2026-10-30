import { refused } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { berichtChip, mapSpielberichtRefusal } from "./utils.ts";

import type { FLSpielberichtZustand } from "@/core/generated/client/types.ts";

const VORSCHLAG = { team1_tore: 3, team2_tore: 1, elfmeterschiessen: null, sonderereignis: null };

const chip = (zustand: FLSpielberichtZustand) => berichtChip({ spiel_id: "68c1f0a2b3c4d5e6f7a8b9e2", zustand, ergebnis_vorschlag: VORSCHLAG });

describe("what an administrator's card says of its report", () => {
  it("names a proposal still to adopt with its score", () => {
    expect(chip("vorgeschlagen")).toStrictEqual({ worte: "Ergebnis vorgeschlagen", vorschlag: VORSCHLAG, tone: "info" });
  });

  /* `abweichend` is also a first report beside a result typed by hand, which nobody changed: „geändert“ would be false. */
  it("names a report the result does not stand on as not adopted, in the panel's warning tone", () => {
    expect(chip("abweichend")).toStrictEqual({ worte: "Bericht nicht übernommen", vorschlag: VORSCHLAG, tone: "warning" });
  });

  /* The triage cards of every section carry the chip, so a state awaiting nobody chipping its card would ask for an
     adoption no press offers: a called-off fixture's panel is read-only. */
  it("says nothing of a report awaiting nobody", () => {
    expect([chip("uebernommen"), chip("abgesagt")]).toStrictEqual([null, null]);
  });

  /* Proposed for other clubs than the fixture fields now: its score beside the card's clubs would read as theirs. */
  it("names a report about other teams without its score", () => {
    expect(chip("teams_geaendert")).toStrictEqual({ worte: "Bericht zu anderen Teams", vorschlag: null, tone: "warning" });
  });
});

describe("a write composed on a report that has changed since", () => {
  /* The reload draws the form anew, so each reader is told to enter the change again, and who else writes the report. */
  it("tells each reader to reload and enter the change again, naming the other writer", () => {
    const schiedsrichter = mapSpielberichtRefusal(refused("REQ-BERICHT-006"), "schiedsrichter");
    const admin = mapSpielberichtRefusal(refused("REQ-BERICHT-006"), "admin");

    for (const answer of [schiedsrichter, admin]) {
      expect(answer?.error ?? "").toMatch(
        /^Der Spielbericht wurde inzwischen geändert.*Lade die Seite neu und trage Deine Änderung dort erneut ein\.$/,
      );
    }
    expect(schiedsrichter?.error ?? "").toMatch(/von der Verwaltung/);
    expect(admin?.error ?? "").toMatch(/von der Schiedsrichterin oder dem Schiedsrichter/);
  });
});

describe("a referee's write on a fixture called off since the page opened", () => {
  /* A report may stand from before the call-off, so the refusal says the fixture takes none, never that none exists, and
     sends the referee to the reload that shows the fixture as it is. */
  it("says the fixture takes no report, and how to see it as it stands", () => {
    const answer = mapSpielberichtRefusal(refused("REQ-BERICHT-004"), "schiedsrichter");

    expect(answer?.error).toBe(
      "Dieses Spiel ist inzwischen als ausgefallen oder annulliert eingetragen und nimmt keinen Spielbericht an. Lade die Seite neu.",
    );
  });
});
