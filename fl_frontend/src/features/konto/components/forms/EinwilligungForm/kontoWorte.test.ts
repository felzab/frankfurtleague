import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Fragment, createElement as h } from "react";

import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { SPIELER_UMFANG_FRAGE } from "@/features/registrierungen/constants.ts";
import { SCHIEDSRICHTER_UMFANG_FRAGE } from "@/features/schiedsrichter/constants.ts";
import { textOf } from "@/shared/testing/renderTest.ts";

const { schiedsrichterWorte, sitzTitel, sitzWorte, spielerWorte } = await import("./kontoWorte.tsx");
const { renderTree } = await import("@/shared/testing/renderTest.ts");

const gerendert = (node: unknown): string => textOf(renderTree(h(Fragment, null, node as never)));

describe("the account page's controls drawn from the served wording", () => {
  it("names the pupil's chips and switch by the running wording's own controls, and posts that wording's label", () => {
    const fassung = publishedLaufendeFassung("konto_spieler");
    const worte = spielerWorte(fassung, SPIELER_UMFANG_FRAGE);

    assert.equal(worte.textVersion, fassung.text_version);
    assert.deepEqual(worte.umfang?.optionen, fassung.bedienelemente);
    assert.equal(worte.medien.schalter, fassung.schalter);
  });

  /* Each paragraph from its own section, the floor filled: a paragraph put under the wrong control
     describes the other choice, and a slot left standing reads as unfinished. */
  it("puts each section under the control it governs and fills the age floor", () => {
    const fassung = publishedLaufendeFassung("konto_spieler");
    const worte = spielerWorte(fassung, SPIELER_UMFANG_FRAGE);
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

    assert.throws(() => spielerWorte({ ...fassung, absaetze_nach_schluessel: null }, SPIELER_UMFANG_FRAGE));
    assert.throws(() => spielerWorte(publishedLaufendeFassung("bestaetigung_spieler"), SPIELER_UMFANG_FRAGE));
  });

  /* Every seat's two switches carry the same served words, so only their names tell a screen reader which
     choice a press moves: the registry's two names must differ. */
  it("names a seat's WhatsApp switch and its media switch apart", () => {
    const worte = sitzWorte(publishedLaufendeFassung("konto_kontakt"), { team_name: "Lessing Lions", saison_id: "2526" });

    assert.ok(worte.whatsapp !== undefined, "a seat is offered no WhatsApp switch");
    assert.notEqual(worte.whatsapp.schalter, worte.medien.schalter);
  });

  /* Each record's reason for taking a withdrawal alone is its label's own paragraph, shown beside that
     record and no other: a pending registration's sentence on a retired pupil's record misstates why. */
  it("hands each record the reason its label gives for taking a withdrawal alone, and an active record none", () => {
    const spieler = publishedLaufendeFassung("konto_spieler").absaetze_nach_schluessel ?? assert.fail("no keyed pupil wording");
    const schiedsrichter = publishedLaufendeFassung("konto_schiedsrichter").absaetze_nach_schluessel ?? assert.fail("no keyed referee wording");
    const kontakt = publishedLaufendeFassung("konto_kontakt").absaetze_nach_schluessel ?? assert.fail("no keyed contact wording");
    const sitz = { team_name: "Lessing Lions", saison_id: "2526" };

    assert.deepEqual(
      [
        spielerWorte(publishedLaufendeFassung("konto_spieler"), SPIELER_UMFANG_FRAGE).nurWiderruf,
        spielerWorte(publishedLaufendeFassung("konto_spieler"), SPIELER_UMFANG_FRAGE, "nichtAktiv").nurWiderruf,
        spielerWorte(publishedLaufendeFassung("konto_spieler"), SPIELER_UMFANG_FRAGE, "bisAufnahme").nurWiderruf,
        schiedsrichterWorte(publishedLaufendeFassung("konto_schiedsrichter"), SCHIEDSRICHTER_UMFANG_FRAGE, false).nurWiderruf,
        schiedsrichterWorte(publishedLaufendeFassung("konto_schiedsrichter"), SCHIEDSRICHTER_UMFANG_FRAGE, true).nurWiderruf,
        sitzWorte(publishedLaufendeFassung("konto_kontakt"), sitz).nurWiderruf,
        sitzWorte(publishedLaufendeFassung("konto_kontakt"), sitz, "vorbei").nurWiderruf,
        sitzWorte(publishedLaufendeFassung("konto_kontakt"), sitz, "bisZusage").nurWiderruf,
      ],
      [
        undefined,
        spieler.nurWiderrufNichtAktiv,
        spieler.nurWiderrufBisAufnahme,
        undefined,
        schiedsrichter.nurWiderrufNichtAktiv,
        undefined,
        kontakt.nurWiderrufVorbei,
        kontakt.nurWiderrufBisZusage,
      ],
    );
  });
});
