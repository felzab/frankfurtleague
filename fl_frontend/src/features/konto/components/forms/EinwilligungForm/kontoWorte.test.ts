import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Fragment, createElement as h } from "react";

import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { SPIELER_UMFANG_FRAGE } from "@/features/registrierungen/constants.ts";
import { textOf } from "@/shared/testing/renderTest.ts";

const { personWorte, sitzTitel, sitzWorte } = await import("./kontoWorte.tsx");
const { renderTree } = await import("@/shared/testing/renderTest.ts");

const gerendert = (node: unknown): string => textOf(renderTree(h(Fragment, null, node as never)));

describe("the account page's controls drawn from the served wording", () => {
  it("names the pupil's chips and switch by the running wording's own controls, and posts that wording's label", () => {
    const fassung = publishedLaufendeFassung("konto_spieler");
    const worte = personWorte(fassung, SPIELER_UMFANG_FRAGE);

    assert.equal(worte.textVersion, fassung.text_version);
    assert.deepEqual(worte.umfang?.optionen, fassung.bedienelemente);
    assert.equal(worte.medien.schalter, fassung.schalter);
  });

  /* Each paragraph from its own section, the floor filled: a paragraph put under the wrong control
     describes the other choice, and a slot left standing reads as unfinished. */
  it("puts each section under the control it governs and fills the age floor", () => {
    const fassung = publishedLaufendeFassung("konto_spieler");
    const worte = personWorte(fassung, SPIELER_UMFANG_FRAGE);
    const sections = fassung.absaetze_nach_schluessel ?? assert.fail("the pupil's account wording carries no keyed sections");

    assert.equal(gerendert(worte.umfang?.absatz), sections.veroeffentlichung);
    assert.equal(gerendert(worte.medien.absatz), sections.medien?.replace("{medienMinAlter}", "18"));
    assert.equal(gerendert(worte.widerruf), sections.widerruf);
  });

  /* A seat's scope is no publication choice: a WhatsApp switch named by the registry's control, its own
     paragraph beside it, where a person's record carries chips. */
  it("fills a seat's team and season into both switches' paragraphs and its title", () => {
    const fassung = publishedLaufendeFassung("konto_kontakt");
    const sitz = { rollen: ["ansprechperson", "trainer"] as const, team_name: "Lessing Lions", saison_id: "2526" };
    const worte = sitzWorte(fassung, sitz);

    assert.equal(worte.umfang, undefined);
    assert.equal(worte.whatsapp?.schalter, fassung.bedienelemente.kontaktdaten_whatsapp);
    assert.ok(gerendert(worte.whatsapp?.absatz).includes("für Lessing Lions in der Saison 2526"));
    assert.ok(gerendert(worte.medien.absatz).includes("für Lessing Lions in der Saison 2526"));
    assert.equal(sitzTitel(sitz), "Als Ansprechperson und Trainerin oder Trainer: Lessing Lions, Saison 2526");
  });

  /* A wording missing a section is a registry fault: a blank paragraph would describe a control by nothing. */
  it("refuses a wording that is not the account page's", () => {
    const fassung = publishedLaufendeFassung("konto_spieler");

    assert.throws(() => personWorte({ ...fassung, absaetze_nach_schluessel: null }, SPIELER_UMFANG_FRAGE));
    assert.throws(() => personWorte(publishedLaufendeFassung("bestaetigung_spieler"), SPIELER_UMFANG_FRAGE));
  });
});
