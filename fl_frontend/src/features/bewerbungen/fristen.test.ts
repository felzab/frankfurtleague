import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EINWILLIGUNG_SEITEN } from "@/core/einwilligungSeiten.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/registrierungen/constants.ts";
import { SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE } from "@/features/schiedsrichter/constants.ts";

import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_ERINNERUNG_TAGE } from "./constants.ts";

import type { BewerbungBestaetigungData } from "@/core/bewerbungEmail.ts";
import type { EinwilligungSeite } from "@/core/einwilligungSeiten.ts";

registerDoubles();

const {
  buildBewerbungBestaetigungEmail,
  buildBewerbungEingangOffenEmail,
  buildBewerbungErinnerungEmail,
  buildBewerbungGeloeschtEmail,
  buildBewerbungVollstaendigEmail,
  buildBewerbungWiderspruchEmail,
} = await import("@/core/bewerbungEmail.ts");
const { readEinwilligungDocument } = await import("@/core/einwilligungDocument.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

/** Not a token, and not shaped like one: a fixture a reader could mistake for a credential is one somebody copies. */
const LINK = `${ORIGIN}/bestaetigung/kontakt?token=beispiel-eins`;
const FRIST = "18.09.2026";

const ERIKA = { vorname: "Erika", rolleText: "Ansprechperson", link: LINK };
const JONAS = { vorname: "Jonas", rolleText: "Trainerin oder Trainer", link: LINK };
const AUSSTEHEND = [{ vorname: "Jonas", rolleText: "Trainerin oder Trainer" }];

const EIN_SITZ = {
  saisonId: "2627",
  origin: ORIGIN,
  schule: "Ernst-Reuter-Schule",
  seats: [ERIKA],
  fristText: FRIST,
} satisfies BewerbungBestaetigungData;
/* Both arms of every builder that has two: the plural wording is a second copy of each sentence, and
   only a render of it reads the clock it states. */
const ZWEI_SITZE = { ...EIN_SITZ, seats: [ERIKA, JONAS] } satisfies BewerbungBestaetigungData;

const MESSAGES = [
  ["the link message", buildBewerbungBestaetigungEmail(EIN_SITZ)],
  ["the link message to a shared inbox", buildBewerbungBestaetigungEmail(ZWEI_SITZE)],
  ["the reminder", buildBewerbungErinnerungEmail(EIN_SITZ)],
  ["the reminder to a shared inbox", buildBewerbungErinnerungEmail(ZWEI_SITZE)],
  [
    "the receipt",
    buildBewerbungEingangOffenEmail({
      saisonId: "2627",
      origin: ORIGIN,
      rollenText: "Ansprechperson",
      ausstehend: AUSSTEHEND,
      fristText: FRIST,
      link: LINK,
    }),
  ],
  ["the completeness notice", buildBewerbungVollstaendigEmail({ saisonId: "2627", origin: ORIGIN, rollenText: "Ansprechperson" })],
  [
    "the deletion notice",
    buildBewerbungGeloeschtEmail({ saisonId: "2627", origin: ORIGIN, rollenText: "Ansprechperson", ausstehend: AUSSTEHEND }),
  ],
  [
    "the seat's decline notice",
    buildBewerbungWiderspruchEmail({
      saisonId: "2627",
      origin: ORIGIN,
      rollenText: "Ansprechperson",
      abgelehnt: { vorname: "Mira", rolleText: "Stellvertretung" },
      fristText: FRIST,
    }),
  ],
] as const;

/** German writes a small count in words, so „drei Tage“ is as much a clock as „14 Tage“ is. */
const NUMBER_WORD: Readonly<Record<string, number>> = { drei: 3, sieben: 7, vierzehn: 14 };

/**
 * Each page's deletion clock, keyed by page so a known page's new label needs no entry; `null` where
 * its flow sets none. Typed over every page: a new one fails to compile until its flow is named.
 */
const STAMPED_CLOCK: Readonly<Record<EinwilligungSeite, number | null>> = {
  bewerbung: BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
  bestaetigung_kontakt: BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
  bestaetigung_kontakt_verwaltung: BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
  // A season row's link runs the application's clock too: `BestaetigungView` states it for that link.
  bestaetigung_kontakt_saison: BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
  bestaetigung_spieler: REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE,
  // The returning pupil's link is a registration's link all the same.
  bestaetigung_spieler_wiederkehrend: REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE,
  bestaetigung_schiedsrichter: SCHIEDSRICHTER_BESTAETIGUNG_FRIST_TAGE,
  konto_spieler: null,
  konto_schiedsrichter: null,
  konto_kontakt: null,
};

/** Whether the registry's page name is one this frontend renders. */
const istSeite = (seite: string): seite is EinwilligungSeite => (EINWILLIGUNG_SEITEN as readonly string[]).includes(seite);

/** Every day count a text states, and `null` for one written in a word this reader does not hold. */
function daysIn(text: string): (number | null)[] {
  // Letters and digits alone: the markup puts a `>` against the number, and a non-whitespace run
  // would carry the whole opening tag into the token.
  return [...text.matchAll(/([\p{L}\d]+)\s+Tage[n]?\b/gu)].map((treffer) => {
    const word = (treffer[1] ?? "").toLowerCase();

    return /^\d+$/.test(word) ? Number(word) : (NUMBER_WORD[word] ?? null);
  });
}

const readLink = (mail: { html: string; text: string }): (number | null)[] => daysIn(`${mail.html} ${mail.text}`);

describe("the two clocks the workflow messages state", () => {
  /* First: a set of messages naming no day at all would leave every case below passing over nothing,
     and a builder that stopped stating its clock is exactly what that looks like. */
  it("finds a day count in the messages at all", () => {
    const foundLink = MESSAGES.flatMap(([, mail]) => readLink(mail));

    assert.ok(foundLink.length >= MESSAGES.length, "the messages state fewer day counts than there are messages");
  });

  it("states no day count but the two the constants set", () => {
    for (const [wer, mail] of MESSAGES) {
      for (const number of readLink(mail)) {
        assert.ok(number !== null, `${wer} writes a day count in a word this case cannot read`);
        assert.ok(
          number === BEWERBUNG_ERINNERUNG_TAGE || number === BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
          `${wer} states ${String(number)} days, which is neither clock`,
        );
      }
    }
  });

  /* Each on its own, so a bound raised to the other's number cannot pass by the set still holding
     two members. */
  it("states each of the two somewhere across them", () => {
    const allSeats = new Set(MESSAGES.flatMap(([, mail]) => readLink(mail)));

    assert.ok(allSeats.has(BEWERBUNG_ERINNERUNG_TAGE), "no message states the reminder's clock");
    assert.ok(allSeats.has(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE), "no message states the deletion's clock");
  });

  /* The stamped text is never interpolated from the constant: the words are what somebody was shown,
     so a moved bound has to fail here and be minted as a new label rather than reword this one. */
  it("holds each stamped wording to its own flow's deletion clock, written in a word", () => {
    const gelesen = Object.entries(readEinwilligungDocument().fassungen).flatMap(([label, fassung]) =>
      daysIn(fassung.absaetze.join(" ")).map((number) => [label, fassung.seite, number] as const),
    );

    assert.ok(gelesen.length > 0, "no stored wording states a day count, so this case compares nothing");
    for (const [label, seite, number] of gelesen) {
      assert.ok(istSeite(seite), `${label} names the page ${seite}, which this frontend renders nowhere`);
      assert.equal(number, STAMPED_CLOCK[seite], `${label} states a deletion clock no bound of its flow sets`);
    }
  });
});
