import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLSpielSchema } from "@/features/spiele/schemas.ts";
import { FLSpieltagWithSpieleSchema } from "@/features/spieltage/schemas.ts";
import { labelBadge, PILL_TINT_CLASSES } from "@/shared/components/ui/badges.ts";
import { card } from "@/shared/components/ui/card.ts";
import { side, spielFields } from "@/shared/testing/fixtures.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSaisonPhase } from "@/features/saisons/schemas.ts";
import type { FLSpielQuelle } from "@/features/spiele/schemas.ts";
import type { FLSpieltagWithSpiele } from "@/features/spieltage/schemas.ts";
import type { PillTone } from "@/shared/components/ui/badges.ts";

/* Reached with `await import` and never a static import beside the harness above, which registers the
   JSX compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminBracketWiringView } = await import("./AdminBracketWiringView.tsx");

const fixture = (spielNr: number, phase: FLSaisonPhase, sides: Partial<Parameters<typeof spielFields>[0]>) =>
  FLSpielSchema.parse(
    spielFields({
      id: `6890a1b2c3d4e5f6071829${String(spielNr).padStart(2, "0")}`,
      spiel_nr: spielNr,
      saison_phase: phase,
      saison_id: "2026",
      ...sides,
    }),
  );

const round = (phase: FLSaisonPhase, spiele: ReturnType<typeof fixture>[]): FLSpieltagWithSpiele =>
  FLSpieltagWithSpieleSchema.parse({
    id: `6890a1b2c3d4e5f6071828${String(spiele[0]?.spiel_nr ?? 0).padStart(2, "0")}`,
    beginn: null,
    ende: null,
    anzahl_spiele: spiele.length,
    position: 1,
    saison_phase: phase,
    saison_id: "2026",
    spiele,
  });

const gruppe = (platz: number): FLSpielQuelle => ({ type: "gruppe", gruppe: "A", platz });
const sieger = (spielNr: number): FLSpielQuelle => ({ type: "spiel", ausgang: "sieger", spiel_nr: spielNr });

/**
 * Every origin a slot can have, across two rounds. The Halbfinale is fed by the Viertelfinale's first
 * fixture and by a number the season does not hold, which is where the kind's own tint answers.
 */
const ROUNDS = [
  round("viertelfinale", [
    fixture(1, "viertelfinale", { team1: null, team2: null, team1_quelle: gruppe(1), team2_quelle: gruppe(2) }),
    fixture(2, "viertelfinale", { team1: side("6890a1b2c3d4e5f607182950", { name: "Lessing-Kolleg" }), team2: null }),
  ]),
  round("halbfinale", [fixture(3, "halbfinale", { team1: null, team2: null, team1_quelle: sieger(1), team2_quelle: sieger(99) })]),
];

const HTML = renderMarkup(AdminBracketWiringView, { rounds: ROUNDS, saisonId: "2026", isFinishedSaison: false });

const FIXTURES = ROUNDS.flatMap((wired) => wired.spiele);

/** The class list of the element whose own words are `words`, read off the render. */
function classOf(words: string): string {
  const drawn = [...HTML.matchAll(/<(\w+)\b[^>]*\sclass="([^"]*)"[^>]*>([^<]*)<\/\1>/g)].filter((element) => element[3] === words);
  assert.equal(drawn.length > 0, true, `the review draws no element reading „${words}“`);

  return drawn[0]?.[2] ?? "";
}

/** The origin chip a slot wears, with the tone its classes name, or `null` where they name none. */
function toneOf(words: string): PillTone | null {
  const classes = classOf(words);
  const tones = (Object.keys(PILL_TINT_CLASSES) as PillTone[]).filter((tone) => classes === `${labelBadge(tone)} max-w-full`);

  return tones[0] ?? null;
}

/** The fixture table, which `<table>` does not nest in: the round panel around it is the one card this view owes. */
const TABLES = [...HTML.matchAll(/<table\b[\s\S]*?<\/table>/g)].map((table) => table[0]);

/** Every cell drawing the two seats, found by the seat names only that cell carries. */
const PAIR_CELLS = [...HTML.matchAll(/<td\b[\s\S]*?<\/td>/g)].map((cell) => cell[0]).filter((cell) => cell.includes(">Team 1<"));

describe("the bracket wiring review", () => {
  /* The fact under review is the edge, and a match card drops the provenance the moment a winner
     arrives. `.claude/rules/frontend.md` carries it as "render its wiring as cards". */
  it("draws each fixture as a table row, and nothing inside the table as a card", () => {
    assert.equal(TABLES.length, ROUNDS.length, "a round's fixtures are drawn outside a table");

    const rows = TABLES.flatMap((table) => [...table.matchAll(/<tr\b[^>]*>/g)]).length;
    // Each table carries its header row beside one row per fixture.
    assert.equal(rows, FIXTURES.length + ROUNDS.length, "a fixture is drawn other than as a row of the table");

    for (const table of TABLES) assert.ok(!table.includes(card()), "a fixture inside the table wears the card recipe");
  });

  /* Auto layout reads a declared width as a preference, so the longest club name in the pair column
     pushes the number and the action columns off the widths they declare. */
  it("lays its columns out fixed, so the two narrow ones hold", () => {
    for (const table of TABLES) {
      const classes = /^<table\b[^>]*\sclass="([^"]*)"/.exec(table)?.[1] ?? "";
      assert.ok(classes.split(/\s+/).includes("table-fixed"), `the table leaves its columns to auto layout: ${classes}`);
    }
  });

  /* `.cards-cascade [role="listitem"]` in `fl_frontend/src/app/globals.css` is a DESCENDANT selector,
     so a second one anywhere inside a round panel takes the card entrance as well. */
  it("marks one list item per round and none below it", () => {
    const items = HTML.match(/\srole="listitem"/g)?.length ?? 0;

    assert.equal(items, ROUNDS.length, `${String(items)} elements carry role="listitem", and the cascade animates each of them`);
  });

  /* Four states, four fills, so a chip answers "does this need me?" first. Flattened to one value the
     panel reads as one colour; flattened to bare ink it stops being a chip. */
  it("paints the four origins in four distinct label pills", () => {
    const origins = ["1. der Gruppe A", "Sieger von Spiel 99", "Manuell gesetzt", "Ohne Herkunft"];
    const tones = origins.map((origin) => toneOf(origin));

    // The app's own pill: a Chip's `color` resolves against HeroUI's tokens, which this app maps none
    // of, and a Tag renders unstyled.
    assert.deepEqual(
      tones.filter((tone) => tone === null),
      [],
      `an origin wears no label pill: ${origins.map((origin) => `${origin}: ${classOf(origin)}`).join(" | ")}`,
    );
    assert.equal(new Set(tones).size, origins.length, `two origins read alike: ${tones.join(", ")}`);
  });

  /* The chip names the round a slot is fed FROM, not the round it stands in, so the panel's own
     phase must never be what colours it — one round can be fed by two. */
  it("colours a slot from the phase of the fixture feeding it", () => {
    assert.equal(toneOf("Sieger von Spiel 1"), "viertelfinale", "the Halbfinale's slot wears a phase other than its feeder's");
  });

  /* A visible seat digit sits one space from an origin opening on its own ordinal, so "1" and "1. der
     Gruppe A" read as one doubled number. The chips and the order carry the seat on sight. */
  it("names each seat once per slot, and only where it cannot be seen", () => {
    for (const seat of ["Team 1", "Team 2"]) {
      const named = [...HTML.matchAll(new RegExp(`<(\\w+)\\b([^>]*)>${seat}</\\1>`, "g"))];

      assert.equal(named.length, FIXTURES.length, `${seat} is named ${String(named.length)} times over ${String(FIXTURES.length)} fixtures`);
      for (const [, , attributes] of named) {
        assert.match(attributes ?? "", /\sclass="sr-only"/, `${seat} is drawn, and it reads as a second number beside the origin`);
      }
    }
  });

  /* The shape the doubled number had: a marker drawn for the eye and hidden from the reading, one
     space from an origin that opens on an ordinal of its own. A childless one is decoration. */
  it("draws no reading in the pair cell that is hidden from assistive technology", () => {
    assert.equal(PAIR_CELLS.length, FIXTURES.length, "the review draws no pair cell per fixture to read");

    for (const cell of PAIR_CELLS) {
      const silenced = [...cell.matchAll(/<(\w+)\b[^>]*\saria-hidden="true"[^>]*>([\s\S]*?)<\/\1>/g)].filter(
        (element) => textOf(element[2] ?? "").trim() !== "",
      );

      assert.deepEqual(
        silenced.map((element) => element[0]),
        [],
        "the pair cell draws what only the eye gets",
      );
    }
  });
});

describe("the bracket wiring's empty state", () => {
  const empty = (isFinishedSaison: boolean): string =>
    textOf(renderMarkup(AdminBracketWiringView, { rounds: [], saisonId: "2026", isFinishedSaison }), " ");

  /* A finished season's bracket is not still to come, so a „noch“ or a hint waiting on the Spieltage tells a
     reader of a past season to come back for rounds that were never drawn. */
  it("says a finished season has no Finalrunden, and promises none", () => {
    assert.ok(empty(true).includes("Für diese Saison gibt es keine Finalrunden."), empty(true));
    assert.doesNotMatch(empty(true), /\bnoch\b|sobald/i);
  });

  it("keeps the running season's promise that the KO-Runde's Spieltage are still to come", () => {
    assert.ok(empty(false).includes("Für diese Saison gibt es noch keine Finalrunden."), empty(false));
    assert.ok(empty(false).includes("Sobald die Spieltage der KO-Runde angelegt sind"), empty(false));
  });
});
