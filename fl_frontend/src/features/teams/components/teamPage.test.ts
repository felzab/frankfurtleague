import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest.ts";
import { shownText, spokenText } from "@/shared/testing/spokenText.ts";

import type { FLSpiel } from "@/features/spiele/schemas.ts";
import type { FLTeamStatistik } from "@/features/teams/schemas.ts";

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { TeamSaisonVerlauf } = await import("./ui/TeamSaisonVerlauf.tsx");
const { TeamSaisonStatistik } = await import("./ui/TeamSaisonStatistik.tsx");
const { TeamSaisonSpieleTimeline } = await import("./ui/TeamSaisonSpieleTimeline.tsx");

const SIEGER = "6780e194677bfbfb5ea8396c";
const VERLIERER = "6780e19192c4cd94b2504985";
const TODAY = "2026-09-14";

const seite = (teamId: string, name: string, tore: number): FLSpiel["team1"] => ({
  team_id: teamId,
  tore,
  name,
  shorthand: name.slice(0, 2).toUpperCase(),
  austritt_type: null,
});

/** The 2025 semi-final the bracket settled on penalties: level on goals, 5:4 in the shoot-out. */
const HALBFINALE: FLSpiel = {
  id: "6890a1b2c3d4e5f607190201",
  spieltag_id: "6890a1b2c3d4e5f607190202",
  team1: seite(SIEGER, "Mainufer Beispiel", 1),
  team2: seite(VERLIERER, "Musterschule Süd", 1),
  team1_quelle: null,
  team2_quelle: null,
  datum: "2025-09-13",
  uhrzeit: "18:00:00",
  ort: null,
  schiedsrichter: null,
  ergebnis: "1:1",
  elfmeterschiessen: { team1: 5, team2: 4 },
  spiel_nr: 13,
  sonderereignis: null,
  saison_phase: "halbfinale",
  saison_id: "2025",
  notiz: null,
};

const GRUPPENSPIEL: FLSpiel = {
  ...HALBFINALE,
  id: "6890a1b2c3d4e5f607190203",
  datum: "2025-06-14",
  ergebnis: "2:2",
  elfmeterschiessen: null,
  spiel_nr: 4,
  saison_phase: "gruppenphase",
};

/** Each chip's markup, in the row's own order. */
const chips = (teamId: string): string[] =>
  [...renderMarkup(TeamSaisonVerlauf, { teamSpiele: [GRUPPENSPIEL, HALBFINALE], teamId }).matchAll(/<li>(.*?)<\/li>/g)].map(
    (match) => match[1] ?? "",
  );

describe("the Saisonverlauf of a semi-final decided on penalties", () => {
  /* The defect: the loser's chip read „Halbfinale unentschieden“ beside a bracket that had sent the
     club home. The narrow no-break spaces are `IM_ELFMETERSCHIESSEN`'s. */
  it("tells the loser it went out, and says the shoot-out decided it", () => {
    assert.equal(shownText(chips(VERLIERER).at(-1) ?? ""), "Im Halbfinale ausgeschieden (i.\u202FE.)");
  });

  it("tells the winner it won the round, and says the shoot-out decided it", () => {
    assert.equal(shownText(chips(SIEGER).at(-1) ?? ""), "Halbfinale gewonnen (i.\u202FE.)");
  });

  /* A screen reader spells the mark out as two letters, where the timeline beside the chips says the words. */
  it("speaks the mark as the words it stands for", () => {
    assert.equal(spokenText(chips(VERLIERER).at(-1) ?? ""), "Im Halbfinale ausgeschieden (im Elfmeterschießen)");
    assert.equal(spokenText(chips(SIEGER).at(-1) ?? ""), "Halbfinale gewonnen (im Elfmeterschießen)");
  });
});

/** Each item's markup ahead of its card, in the timeline's own order. */
const badgeHeads = (teamSpiele: FLSpiel[], teamId: string): string[] =>
  [
    ...renderTree(h(TeamSaisonSpieleTimeline, { teamSpiele, teamId, today: TODAY, isFinishedSaison: true })).matchAll(
      /<div role="listitem"[^>]*>(.*?)<div class="card/g,
    ),
  ].map((match) => match[1] ?? "");

/** Collapsed on plain space alone: the shoot-out's mark holds narrow no-break spaces, which `\s` flattens. */
const collapsed = (text: string): string =>
  text
    .split(/[ \t\r\n]+/)
    .join(" ")
    .trim();

/** What a sighted reader sees of one item's badge, read through the one reader every such claim takes. */
const shown = (head: string): string => collapsed(shownText(head, " "));

/** What a screen reader hears in the badge's place, through that reader's other half. */
const spoken = (head: string): string => collapsed(spokenText(head, " "));

describe("the timeline badge of a fixture decided on penalties", () => {
  it("shows each side its result with the shoot-out's mark, and leaves a group draw a draw", () => {
    assert.deepEqual(badgeHeads([GRUPPENSPIEL, HALBFINALE], VERLIERER).map(shown), ["U", "N i.\u202FE."]);
    assert.deepEqual(badgeHeads([GRUPPENSPIEL, HALBFINALE], SIEGER).map(shown), ["U", "S i.\u202FE."]);
  });

  /* A lone letter is spelled out rather than read as a word, so a screen reader would say \u201EN\u201C where a
     sighted reader takes in a defeat. */
  it("says the word behind each letter, the shoot-out included, and hides the letters themselves", () => {
    assert.deepEqual(badgeHeads([GRUPPENSPIEL, HALBFINALE], VERLIERER).map(spoken), ["Unentschieden", "Niederlage im Elfmeterschießen"]);
    assert.deepEqual(badgeHeads([GRUPPENSPIEL, HALBFINALE], SIEGER).map(spoken), ["Unentschieden", "Sieg im Elfmeterschießen"]);
  });
});

describe("the timeline badge's letters", () => {
  const SIEG: FLSpiel = { ...GRUPPENSPIEL, id: "6890a1b2c3d4e5f607190204", datum: "2025-05-10", ergebnis: "3:1", spiel_nr: 1 };
  const OFFEN: FLSpiel = { ...GRUPPENSPIEL, id: "6890a1b2c3d4e5f607190205", datum: "2025-07-05", ergebnis: null, spiel_nr: 9 };

  /* The Saisonstatistik heads its record \u201ES / U / N\u201C and the Saisontabelle \u201ES-U-N\u201C: a club page
     naming a win by another letter makes one reader decode two alphabets. */
  it("are the letters the Saisonstatistik heads its record with, in the same order", () => {
    const statistik = renderMarkup(TeamSaisonStatistik, {
      statistik: {
        anzahl_gespielte_spiele: 3,
        siege: 1,
        unentschieden: 1,
        niederlagen: 1,
        tore_geschossen: 4,
        tore_kassiert: 4,
        punkte: 4,
        anzahl_abgesagte_spiele: 0,
      },
    });
    const kopf = /([A-Z]) \/ ([A-Z]) \/ ([A-Z])<\/p>/.exec(statistik);
    assert.ok(kopf, "the Saisonstatistik carries no record heading of three letters");

    const [sieg, unentschieden, niederlage] = badgeHeads([SIEG, GRUPPENSPIEL], SIEGER)
      .map(shown)
      .concat(badgeHeads([SIEG], VERLIERER).map(shown));
    assert.deepEqual([sieg, unentschieden, niederlage], kopf.slice(1));
  });

  it("claim nothing for a fixture with no result, and say so", () => {
    const [head] = badgeHeads([OFFEN], SIEGER);

    assert.equal(shown(head ?? ""), "?");
    assert.equal(spoken(head ?? ""), "Kein Ergebnis");
  });
});

describe("the Saisonstatistik's Differenz", () => {
  const STATISTIK: FLTeamStatistik = {
    anzahl_gespielte_spiele: 4,
    siege: 2,
    niederlagen: 1,
    unentschieden: 1,
    tore_geschossen: 6,
    tore_kassiert: 3,
    punkte: 7,
    anzahl_abgesagte_spiele: 0,
  };

  /** The Differenz card's text. */
  const differenz = (tore_geschossen: number, tore_kassiert: number): string => {
    const text = textOf(renderMarkup(TeamSaisonStatistik, { statistik: { ...STATISTIK, tore_geschossen, tore_kassiert } }), "|");

    return /Differenz\|+([^|]*)/.exec(text)?.[1] ?? assert.fail(`the statistics render no Differenz card: ${text}`);
  };

  // The Saisontabelle's spelling of one figure, so a club's page and its table row cannot disagree.
  it("signs a surplus and leaves a level difference unsigned", () => {
    assert.equal(differenz(6, 3), "+3");
    assert.equal(differenz(1, 4), "-3");
    assert.equal(differenz(2, 2), "0");
  });
});

describe("the timeline's empty state", () => {
  const leer = (isFinishedSaison: boolean) =>
    textOf(renderTree(h(TeamSaisonSpieleTimeline, { teamSpiele: [], teamId: SIEGER, today: TODAY, isFinishedSaison })), " ");

  it("says a finished season holds no fixtures, and promises none", () => {
    assert.ok(leer(true).includes("Für diese Saison gibt es keine Spiele."), leer(true));
    assert.doesNotMatch(leer(true), /\bnoch\b|Sobald/);
  });

  it("keeps the running season's promise that the fixtures are still to come", () => {
    assert.ok(leer(false).includes("Für diese Saison sind noch keine Spiele angesetzt."), leer(false));
  });
});
