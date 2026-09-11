import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `Link` reads the first and `useSaisonHref` the second —
   and the list renders under both. A Next release that moves either module fails this file at import. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

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

const ANSPRECHPERSON = person("Anna", "Körner", "anna.koerner@gymnasium-sachsenhausen.de", "2026-05-03");
const STELLVERTRETUNG = person("Björn", "List", "bjoern.list@gymnasium-sachsenhausen.de", "2026-05-04");
const TRAINER = person("Clara", "Mergen", "clara.mergen@gymnasium-sachsenhausen.de", null);

/**
 * Every mark and every fact one row can carry at once. The club's short name shares nothing with the
 * school's own, so each assertion below reaches the field it names rather than a substring of another.
 */
const VOLL: AdminBewerbungRow = {
  id: "6890a1b2c3d4e5f607190021",
  saison_id: "2627",
  eingereicht_am: "2026-05-01",
  status: "eingereicht",
  team_id: null,
  schule: {
    team_name: "Goethe",
    full_name: "Städtisches Gymnasium am Sachsenhäuser Berg",
    shorthand: "GG",
    schulform: null,
    address: { strasse: "Friedrich-Ebert-Anlage", hausnummer: "26", plz: "60325", stadtteil: "Westend", stadt: "Frankfurt" },
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
const OHNE_ANSPRECHPERSON: AdminBewerbungRow = {
  ...VOLL,
  id: "6890a1b2c3d4e5f607190022",
  kontakte: { ...VOLL.kontakte, ansprechperson: null },
  bestaetigungen: { ansprechperson: null, stellvertretung: VERSCHICKT, trainer: VERSCHICKT },
};

/**
 * An application stored before the confirmation flow, whose three seats an erasure has emptied. It
 * carries none of the facts the card's cells are for.
 */
const LEER: AdminBewerbungRow = {
  ...VOLL,
  id: "6890a1b2c3d4e5f607190023",
  schule: null,
  team_id: "6890a1b2c3d4e5f607190099",
  kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null },
  bestaetigungen: null,
  bestaetigungsfrist: null,
  teamName: "Lessing-Kolleg",
};

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const liste = (rows: AdminBewerbungRow[], dubletten: ReadonlyMap<string, BewerbungDublette> = new Map()): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2627") },
        h(AdminBewerbungenList, { filteredBewerbungen: rows, dubletten: dubletten, emptiness: "none" as const }),
      ),
    ),
  );

/**
 * A space for every tag, then one space for every run: a renderer parting two expressions would
 * otherwise leave a gap inside a sentence this file reads as one.
 */
const text = (html: string): string => textOf(html, " ").replace(/\s+/g, " ");

/** How often a word stands on the card, which is what separates an eyebrow from the pill wearing the same word. */
const mal = (gelesen: string, wort: string): number => gelesen.split(wort).length - 1;

/** The class list of the element whose own text this is, which is what decides whether that text may be clipped. */
const klasse = (html: string, inhalt: string): string =>
  new RegExp(`<span class="([^"]*)"[^>]*>${inhalt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span>`).exec(html)?.[1] ?? "";

describe("what the queue's card carries", () => {
  /* Every fact a table gives a column of its own, beside the two the identity block carries as
     lines. A card losing one of them is the regression the shape invites. */
  it("holds every fact the table's columns and its identity block held", () => {
    const gelesen = text(liste([VOLL], new Map([[VOLL.id, "team"]])));

    for (const fakt of [
      "Goethe",
      "Neue Schule",
      "Team doppelt",
      "Kontakt unerreichbar",
      "2627",
      "Städtisches Gymnasium am Sachsenhäuser Berg",
      "01.05.2026",
      "Bestätigungen",
      "2 von 3 bestätigt",
      "Anna Körner",
      ANSPRECHPERSON.email,
    ])
      assert.ok(gelesen.includes(fakt), `the card no longer carries „${fakt}“: ${gelesen}`);

    // Twice: the queue's standing wears it as a pill, and the date's own cell is headed with it.
    assert.equal(mal(gelesen, "Eingereicht"), 2, `the status pill and the date's eyebrow no longer both read „Eingereicht“: ${gelesen}`);

    assert.match(liste([VOLL]), /aria-label="Bewerbung von Goethe öffnen"/, "the card offers no way into the application");
  });

  /* A fixed heading names one seat for every row, so the row whose Ansprechperson was erased files
     the Trainer's address under the Ansprechperson — the defect a card's own eyebrow cannot have. */
  it("names the seat whose details it shows, rather than one heading for every row", () => {
    const mit = text(liste([VOLL]));
    const ohne = text(liste([OHNE_ANSPRECHPERSON]));

    assert.ok(mit.includes("Ansprechperson"), `the seat holding the address is unnamed: ${mit}`);
    assert.ok(mit.includes(ANSPRECHPERSON.email), "the Ansprechperson's address is not the one shown");
    assert.ok(!mit.includes(TRAINER.email), "the card shows the Trainer beside a seated Ansprechperson");

    assert.ok(ohne.includes("Trainer"), `the stand-in seat is unnamed: ${ohne}`);
    assert.ok(ohne.includes(TRAINER.email), "the Trainer does not stand in for the erased Ansprechperson");
    assert.ok(!ohne.includes("Ansprechperson"), "the Trainer's address is filed under the erased seat");
  });
});

describe("what the card may and may not clip", () => {
  /* A clipped date is another date, so its cell is sized to it and never truncated. The free-text
     lines take the opposite rule: an address longer than its cell is clipped rather than drawn past
     the card. */
  it("gives the date its whole width and holds the free-text lines to their cells", () => {
    const html = liste([VOLL]);

    assert.ok(!klasse(html, "01.05.2026").includes("truncate"), "the submission date is clipped rather than given its width");
    assert.ok(klasse(html, VOLL.schule?.full_name ?? "").includes("truncate"), "the school's name is drawn past the card it sits in");
    assert.ok(klasse(html, ANSPRECHPERSON.email).includes("truncate"), "the address is drawn past the card it sits in");
  });
});

describe("a card whose cells have nothing to hold", () => {
  /* „0 von 3“ over an application that predates the workflow sends an administrator hunting for
     links nobody sent, and an eyebrow over an empty cell reads as a value that failed to load. */
  it("says what is absent instead of counting confirmations nobody asked for", () => {
    const gelesen = text(liste([LEER]));

    assert.ok(gelesen.includes("Keine Bestätigungen angefragt"), `the cell is empty rather than answered: ${gelesen}`);
    assert.ok(!gelesen.includes("bestätigt"), "a count stands over an application with no per-seat state");
    assert.ok(gelesen.includes("Keine Kontaktperson"), "the emptied seat reads as a name that failed to load");
    assert.ok(gelesen.includes("Keine E-Mail"), "the emptied seat's address reads as a value that failed to load");
  });
});
