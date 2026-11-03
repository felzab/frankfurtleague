import { describe, expect, it } from "vitest";

import { outcomeFor } from "./blocks";

import type { FLSonderereignis, FLSpielJoined } from "@/core/generated/client/types";

const GOETHE = "0".repeat(24);
const HELMHOLTZ = "1".repeat(24);

/** A group match between Goethe and Helmholtz, with the goals and the event a case gives it. */
const spiel = (tore: readonly [number, number] | null, sonderereignis: FLSonderereignis | null = null): FLSpielJoined => ({
  id: "2".repeat(24),
  saison_id: "2027",
  saison_phase: "gruppenphase",
  spiel_nr: 1,
  spieltag_id: "3".repeat(24),
  datum: "2027-03-13",
  uhrzeit: "14:00",
  ergebnis: tore === null ? null : `${String(tore[0])}:${String(tore[1])}`,
  elfmeterschiessen: null,
  sonderereignis,
  ansetzung_confirmed: null,
  for_third_place: false,
  notiz: null,
  ort: null,
  schiedsrichter: null,
  team1: { team_id: GOETHE, name: "Goethe", shorthand: "GOE", tore: tore?.[0] ?? null, austritt_type: null },
  team2: { team_id: HELMHOLTZ, name: "Helmholtz", shorthand: "HEL", tore: tore?.[1] ?? null, austritt_type: null },
  team1_quelle: null,
  team2_quelle: null,
});

describe("how a match went for one of its clubs", () => {
  // The club page colours each match's point by it: a side read backwards would paint a loss in the win's green
  // with the score beside it the only line saying otherwise, and nothing failing.
  it("reads the goals from the club's own side, whichever the fixture lists first", () => {
    expect([outcomeFor(spiel([2, 1]), GOETHE), outcomeFor(spiel([2, 1]), HELMHOLTZ)]).toStrictEqual(["won", "lost"]);
    expect([outcomeFor(spiel([0, 3]), GOETHE), outcomeFor(spiel([0, 3]), HELMHOLTZ)]).toStrictEqual(["lost", "won"]);
    expect(outcomeFor(spiel([1, 1]), HELMHOLTZ)).toBe("drawn");
  });

  it("scores nothing for a match without a result, a called-off one among them", () => {
    expect(outcomeFor(spiel(null), GOETHE)).toBe("none");
    expect(outcomeFor(spiel(null, "ausgefallen"), GOETHE)).toBe("none");
  });

  // A forfeit's score and an abandoned match's entered result count, as the Tabelle counts them.
  it("scores a forfeit and an abandoned match by the result entered", () => {
    expect(outcomeFor(spiel([3, 0], "nichtantreten_team2"), GOETHE)).toBe("won");
    expect(outcomeFor(spiel([0, 3], "abgebrochen"), GOETHE)).toBe("lost");
  });
});
