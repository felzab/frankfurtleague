import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { Fragment, createElement as h } from "react";

import { textOf } from "@/shared/testing/renderTest.ts";

import type { KontoFassung } from "./kontoWorte.tsx";

const { personWorte, sitzTitel, sitzWorte, UMFANG_FRAGE_SPIELER } = await import("./kontoWorte.tsx");
const { renderTree } = await import("@/shared/testing/renderTest.ts");

/* The words as the backend publishes them, read from the committed artifact its own test holds equal
   to the registry: a copy typed here would pass against a wording the backend has since changed. */
const REGISTRY = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "..", "..", "..", "..", "..", "..", "..", "fl_backend", "einwilligung.json"), "utf8"),
) as { fassungen: Record<string, KontoFassung>; laufende_fassungen: Record<string, string> };

const laufend = (seite: string): KontoFassung => {
  const label = REGISTRY.laufende_fassungen[seite] ?? assert.fail(`the registry runs no wording on ${seite}`);
  return REGISTRY.fassungen[label] ?? assert.fail(`the registry holds no words for ${label}`);
};

const gerendert = (node: unknown): string => textOf(renderTree(h(Fragment, null, node as never)));

describe("the account page's controls drawn from the served wording", () => {
  it("names the pupil's chips and switch by the running wording's own controls, and posts that wording's label", () => {
    const fassung = laufend("konto_spieler");
    const worte = personWorte(fassung, UMFANG_FRAGE_SPIELER);

    assert.equal(worte.textVersion, fassung.text_version);
    assert.deepEqual(worte.umfang?.optionen, fassung.bedienelemente);
    assert.equal(worte.medien.schalter, fassung.schalter);
  });

  /* Each paragraph from its own section, the floor filled: a paragraph put under the wrong control
     describes the other choice, and a slot left standing reads as unfinished. */
  it("puts each section under the control it governs and fills the age floor", () => {
    const fassung = laufend("konto_spieler");
    const worte = personWorte(fassung, UMFANG_FRAGE_SPIELER);
    const sections = fassung.absaetze_nach_schluessel ?? assert.fail("the pupil's account wording carries no keyed sections");

    assert.equal(gerendert(worte.umfang?.absatz), sections.veroeffentlichung);
    assert.equal(gerendert(worte.medien.absatz), sections.medien?.replace("{medienMinAlter}", "18"));
    assert.equal(gerendert(worte.widerruf), sections.widerruf);
  });

  it("fills a seat's team and season into its paragraph and its title", () => {
    const sitz = { team_name: "Lessing Lions", saison_id: "2526" };
    const worte = sitzWorte(laufend("konto_kontakt"), sitz);

    assert.equal(worte.umfang, undefined);
    assert.ok(gerendert(worte.medien.absatz).includes("für Lessing Lions in der Saison 2526"));
    assert.equal(sitzTitel(sitz), "Fotos, Videos und Interviews: Lessing Lions, Saison 2526");
  });

  /* A wording missing a section is a registry fault: a blank paragraph would describe a control by nothing. */
  it("refuses a wording missing a section it governs", () => {
    const fassung = laufend("konto_spieler");

    assert.throws(() => personWorte({ ...fassung, absaetze_nach_schluessel: null }, UMFANG_FRAGE_SPIELER), /carries no section/);
  });
});
