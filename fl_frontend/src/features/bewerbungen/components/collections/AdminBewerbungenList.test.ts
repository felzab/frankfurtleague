import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLKontaktperson } from "@/features/teams/schemas.ts";
import type { BewerbungDublette } from "../../duplicates.ts";
import type { FLBewerbungBestaetigung } from "../../schemas.ts";
import type { AdminBewerbungRow } from "../../types.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminBewerbungenList } = await import("./AdminBewerbungenList.tsx");

/** `bestaetigt_am` is what decides a seat's state, so each caller says whether this person has answered. */
function person(vorname: string, nachname: string, email: string, bestaetigtAm: string | null): FLKontaktperson {
  return {
    vorname: vorname,
    nachname: nachname,
    email: email,
    telefon: "069 1234567",
    geburtsdatum: null,
    einwilligung: {
      umfang: "kontaktdaten",
      erfasst_von: "administrativ",
      text_version: "kontakte-1",
      datum: "2026-05-01",
      bestaetigt_am: bestaetigtAm,
    },
  };
}

/** A seat whose link went out and whose address the provider has refused for good. */
const UNZUSTELLBAR: FLBewerbungBestaetigung = {
  verschickt_am: "2026-05-01",
  erinnert_am: null,
  abgelehnt_am: null,
  zustellung: { nachricht_id: "msg-1", stand: "unzustellbar", grund: "NoEmail", am: "2026-05-01T09:00:00Z" },
};

const VERSCHICKT: FLBewerbungBestaetigung = { verschickt_am: "2026-05-01", erinnert_am: null, abgelehnt_am: null, zustellung: null };

const ANSPRECHPERSON = person("Erika", "Mustermann", "erika.mustermann@musterschule.example", "2026-05-03");
const STELLVERTRETUNG = person("Max", "Mustermann", "max.mustermann@musterschule.example", "2026-05-04");
const TRAINER = person("Lieschen", "Müller", "lieschen.mueller@musterschule.example", null);

/**
 * Every mark and every fact one row can carry at once. The club's short name shares nothing with the
 * school's own, so each assertion below reaches the field it names rather than a substring of another.
 */
const FULL: AdminBewerbungRow = {
  id: "6890a1b2c3d4e5f607190021",
  saison_id: "2627",
  eingereicht_am: "2026-05-01",
  status: "eingereicht",
  team_id: null,
  schule: {
    team_name: "Goethe",
    full_name: "Städtische Musterschule am Berg",
    shorthand: "GG",
    schulform: null,
    address: { strasse: "Feldweg", hausnummer: "3", plz: "60325", stadtteil: "Westend", stadt: "Frankfurt" },
    website_url: null,
  },
  kontakte: {
    trainer: TRAINER,
    ansprechperson: ANSPRECHPERSON,
    stellvertretung: STELLVERTRETUNG,
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "", wunschfarbe: null },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 3 },
  stufengroesse: null,
  wunschgegner: null,
  entscheidung: null,
  bestaetigungen: { ansprechperson: UNZUSTELLBAR, stellvertretung: VERSCHICKT, trainer: VERSCHICKT },
  bestaetigungsfrist: "2026-05-15",
  teamName: "Goethe",
  inSelectedSaison: true,
};

/** The same application with its Ansprechperson erased, which is what puts the Trainer in the card. */
const WITHOUT_ANSPRECHPERSON: AdminBewerbungRow = {
  ...FULL,
  id: "6890a1b2c3d4e5f607190022",
  kontakte: { ...FULL.kontakte, ansprechperson: null },
  bestaetigungen: { ansprechperson: null, stellvertretung: VERSCHICKT, trainer: VERSCHICKT },
};

/**
 * An application stored before the confirmation flow, whose three seats an erasure has emptied. It
 * carries none of the facts the card's cells are for.
 */
const EMPTY: AdminBewerbungRow = {
  ...FULL,
  id: "6890a1b2c3d4e5f607190023",
  schule: null,
  team_id: "6890a1b2c3d4e5f607190099",
  kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null },
  bestaetigungen: null,
  bestaetigungsfrist: null,
  teamName: "Lessing-Kolleg",
};

const list = (rows: AdminBewerbungRow[], dubletten: ReadonlyMap<string, BewerbungDublette> = new Map()): string =>
  renderTree(
    underNext(h(AdminBewerbungenList, { filteredBewerbungen: rows, dubletten: dubletten, emptiness: "none" as const }), {
      search: "saison_id=2627",
    }),
  );

/**
 * A space for every tag, then one space for every run: a renderer parting two expressions would
 * otherwise leave a gap inside a sentence this file reads as one.
 */
const text = (html: string): string => textOf(html, " ").replace(/\s+/g, " ");

/** How often a word stands on the card, which is what separates an eyebrow from the pill wearing the same word. */
const times = (read: string, word: string): number => read.split(word).length - 1;

describe("what the queue's card carries", () => {
  /* Every fact a table gives a column of its own, beside the two the identity block carries as
     lines. A card losing one of them is the regression the shape invites. */
  it("holds every fact the table's columns and its identity block held", () => {
    const read = text(list([FULL], new Map([[FULL.id, "team"]])));

    for (const fact of [
      "Goethe",
      "Neue Schule",
      "Team doppelt",
      "Kontakt unerreichbar",
      "2627",
      "Städtische Musterschule am Berg",
      "01.05.2026",
      "Bestätigungen",
      "2 von 3 bestätigt",
      "Erika Mustermann",
      ANSPRECHPERSON.email,
    ])
      assert.ok(read.includes(fact), `the card no longer carries „${fact}“: ${read}`);

    // Twice: the queue's standing wears it as a pill, and the date's own cell is headed with it.
    assert.equal(times(read, "Eingereicht"), 2, `the status pill and the date's eyebrow no longer both read „Eingereicht“: ${read}`);

    assert.match(list([FULL]), /aria-label="Bewerbung von Goethe öffnen"/, "the card offers no way into the application");
  });

  /* A fixed heading names one seat for every row, so the row whose Ansprechperson was erased files
     the Trainer's address under the Ansprechperson — a card's own eyebrow cannot make that mistake. */
  it("names the seat whose details it shows, rather than one heading for every row", () => {
    const seated = text(list([FULL]));
    const erased = text(list([WITHOUT_ANSPRECHPERSON]));

    assert.ok(seated.includes("Ansprechperson"), `the seat holding the address is unnamed: ${seated}`);
    assert.ok(seated.includes(ANSPRECHPERSON.email), "the Ansprechperson's address is not the one shown");
    assert.ok(!seated.includes(TRAINER.email), "the card shows the Trainer beside a seated Ansprechperson");

    assert.ok(erased.includes("Trainer"), `the stand-in seat is unnamed: ${erased}`);
    assert.ok(erased.includes(TRAINER.email), "the Trainer does not stand in for the erased Ansprechperson");
    assert.ok(!erased.includes("Ansprechperson"), "the Trainer's address is filed under the erased seat");
  });
});

/** An application naming neither a school nor a club — the row `REQ-BEWERBUNG-002` refuses to accept. */
const NOTHING_NAMED: AdminBewerbungRow = { ...EMPTY, id: "6890a1b2c3d4e5f607190024", team_id: null, teamName: null };

describe("which of the two the card says an application is", () => {
  it("badges a picked club as one already in the league", () => {
    const read = text(list([EMPTY]));

    assert.ok(read.includes("Bestehendes Team"), `the picked club is not badged: ${read}`);
    assert.ok(!read.includes("Neue Schule"), "a picked club is badged as a new school");
  });

  /* The row nothing names is not a club already in the league: badged as one, it sends the
     administrator to accept a club that does not exist. */
  it("badges neither where the application names neither", () => {
    const read = text(list([NOTHING_NAMED]));

    // First, so the absences below are read off a card that rendered at all.
    assert.ok(read.includes("Kein Team benannt"), `the card does not render the row nothing names: ${read}`);
    assert.ok(!read.includes("Bestehendes Team"), "a row naming nothing is badged as a club already in the league");
    assert.ok(!read.includes("Neue Schule"), "a row naming nothing is badged as a new school");
  });
});

describe("a card whose cells have nothing to hold", () => {
  /* „0 von 3“ over an application that predates the workflow sends an administrator hunting for
     links nobody sent, and an eyebrow over an empty cell reads as a value that failed to load. */
  it("says what is absent instead of counting confirmations nobody asked for", () => {
    const read = text(list([EMPTY]));

    assert.ok(read.includes("Keine Bestätigungen angefragt"), `the cell is empty rather than answered: ${read}`);
    assert.ok(!read.includes("bestätigt"), "a count stands over an application with no per-seat state");
    assert.ok(read.includes("Keine Kontaktperson"), "the emptied seat reads as a name that failed to load");
    assert.ok(read.includes("Keine E-Mail"), "the emptied seat's address reads as a value that failed to load");
  });
});
