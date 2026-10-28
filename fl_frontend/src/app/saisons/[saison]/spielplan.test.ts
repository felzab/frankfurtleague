import { describe, expect, it, vi } from "vitest";

import { currentMatchday, factsOf, matchRowOf, readSpielplan } from "./spielplan.ts";

import type { FLSaison } from "@/features/saisons/schemas.ts";
import type { FLSpiel } from "@/features/spiele/schemas.ts";
import type { Matchday } from "./spielplan.ts";

// A group matchday at position 3 and the final at position 1, as the backend serves them: `position` restarts
// at 1 in every phase, so a position alone names no matchday of the season.
vi.mock("@/features/spieltage/queries", () => ({
  getSpieltage: async () => ({
    spieltage: [
      { id: "a".repeat(24), saison_phase: "gruppenphase", position: 3 },
      { id: "b".repeat(24), saison_phase: "finale", position: 1 },
    ],
  }),
}));
vi.mock("@/features/spiele/queries", () => ({ getSpiele: async () => ({ spiele: [] }) }));

/** A fixture as the public read serves it: dated, booked and unplayed unless a case says otherwise. */
function spiel(fields: Partial<FLSpiel> = {}): FLSpiel {
  return {
    id: "a".repeat(24),
    spieltag_id: "b".repeat(24),
    team1: { team_id: "c".repeat(24), name: "Ahorn", shorthand: "AH", tore: null, austritt_type: null },
    team2: { team_id: "d".repeat(24), name: "Kastanie", shorthand: "KA", tore: null, austritt_type: null },
    team1_quelle: null,
    team2_quelle: null,
    datum: "2027-03-14",
    uhrzeit: "15:30:00",
    ort: { spielort_id: "e".repeat(24), name: "Sportplatz Ahornweg", maps_link: "Sportplatz Ahornweg, Ahornweg 2" },
    schiedsrichter: { name: "Anna A.", name_is_public: true },
    ergebnis: null,
    elfmeterschiessen: null,
    spiel_nr: 1,
    sonderereignis: null,
    saison_phase: "gruppenphase",
    saison_id: "2027",
    notiz: null,
    ansetzung_bestaetigt: null,
    ...fields,
  };
}

const matchday = (id: string, spiele: FLSpiel[]): Matchday => ({ id, key: `gruppenphase-${id}`, label: `${id}. Spieltag`, spiele });

describe("the matchday the tabs open on", () => {
  const played = spiel({ ergebnis: "2:1" });
  const calledOff = spiel({ sonderereignis: "ausgefallen" });

  it("is the first holding a match still to be played", () => {
    expect(currentMatchday([matchday("1", [played]), matchday("2", [played, spiel()]), matchday("3", [spiel()])], false)).toBe("2");
  });

  it("skips a matchday whose only open match was called off", () => {
    expect(currentMatchday([matchday("1", [calledOff]), matchday("2", [spiel()])], false)).toBe("2");
  });

  it("is the last once every match is played, and every one of a finished season", () => {
    expect(currentMatchday([matchday("1", [played]), matchday("2", [played])], false)).toBe("2");
    expect(currentMatchday([matchday("1", [spiel()]), matchday("2", [spiel()])], true)).toBe("2");
  });

  it("is none without a matchday", () => {
    expect(currentMatchday([], false)).toBeNull();
  });
});

describe("a match as a row", () => {
  it("opens the match's page and adds a shoot-out's goals to the result it carries", () => {
    const row = matchRowOf(spiel({ ergebnis: "1:1", elfmeterschiessen: { team1: 4, team2: 3 } }));
    expect(row.href).toBe(`/saisons/2027/spiele/${"a".repeat(24)}`);
    expect(row.when).toBe("So., 14.03. · 15:30");
    expect(row.result).toEqual({ tore: { team1: 1, team2: 1 }, elfmeterschiessen: { team1: 4, team2: 3 } });
  });

  it("carries no result until one is entered, so an unplayed match never reads 0:0", () => {
    expect(matchRowOf(spiel()).result).toBeUndefined();
  });

  it("names a side the draw has not settled by its source, short in the plaque", () => {
    const row = matchRowOf(
      spiel({
        team1: null,
        team2: null,
        team1_quelle: { type: "gruppe", gruppe: "A", platz: 1 },
        team2_quelle: { type: "spiel", spiel_nr: 25, ausgang: "verlierer" },
        datum: null,
        uhrzeit: null,
      }),
    );
    expect(row.home).toEqual({ name: "1. der Gruppe A", plaque: { quelle: "A1" } });
    expect(row.away).toEqual({ name: "Verlierer von Spiel 25", plaque: { quelle: "V25" } });
    expect(row.when).toBe("Termin offen");
  });
});

describe("a match's facts", () => {
  it("leave out every value the match does not hold", () => {
    const labels = factsOf(spiel({ datum: null, uhrzeit: null, ort: null, schiedsrichter: null, notiz: "  " }), "1. Spieltag").map(
      (fact) => fact.label,
    );
    expect(labels).toEqual(["Spieltag"]);
  });

  it("set the result first, with the shoot-out's mark", () => {
    const [first] = factsOf(spiel({ ergebnis: "1:1", elfmeterschiessen: { team1: 4, team2: 3 } }), "Finale");
    expect(first).toEqual({ label: "Ergebnis", value: "5:4 n. E.", figures: true });
  });

  it("name the side that did not turn up for a no-show", () => {
    const fact = factsOf(spiel({ sonderereignis: "nichtantreten_team2" }), "1. Spieltag").find((each) => each.label === "Sonderereignis");
    expect(fact?.value).toBe("Kastanie nicht angetreten");
  });

  it("link the venue to its map on another site, which opens in a new tab", () => {
    const ort = factsOf(spiel(), "1. Spieltag").find((fact) => fact.label === "Ort");
    expect(ort?.elsewhere).toEqual({
      href: "https://www.google.com/maps/search/?api=1&query=Sportplatz%20Ahornweg%2C%20Ahornweg%202",
      text: "Sportplatz Ahornweg",
    });
  });

  it("hold no referee whose name the public read withholds", () => {
    const labels = factsOf(spiel({ schiedsrichter: { name: null, name_is_public: false } }), "1. Spieltag").map((fact) => fact.label);
    expect(labels).not.toContain("Schiedsrichter");
  });
});

describe("the name the address gives a matchday", () => {
  it("is its stored phase and its stored position, which together are unique in the season", async () => {
    const { matchdays } = await readSpielplan({ id: "2027", status: "active" } as FLSaison);
    expect(matchdays.map((each) => each.key)).toEqual(["gruppenphase-3", "finale-1"]);
  });
});
