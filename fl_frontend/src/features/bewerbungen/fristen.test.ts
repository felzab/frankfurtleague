import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "@/features/registrierungen/constants.ts";

import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_ERINNERUNG_TAGE } from "./constants.ts";

import type { BewerbungBestaetigungData } from "@/core/bewerbungEmail.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const {
  buildBewerbungBestaetigungEmail,
  buildBewerbungEingangOffenEmail,
  buildBewerbungErinnerungEmail,
  buildBewerbungGeloeschtEmail,
  buildBewerbungVollstaendigEmail,
  buildBewerbungWiderspruchEmail,
} = await import("@/core/bewerbungEmail.ts");
const { LIGA_KENNTNISNAHMEN } = await import("@/core/einwilligung.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

/** Not a token, and not shaped like one: a fixture a reader could mistake for a credential is one somebody copies. */
const LINK = `${ORIGIN}/bestaetigung?token=beispiel-eins`;
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
 * The deletion clock a stamped page states, where it is not the application's.
 *
 * A label absent here is held to that one: two flows stamp wordings into one registry, and one
 * number cannot hold both.
 */
const STAMPED_CLOCK: Readonly<Record<string, number>> = {
  "2026-09-spielerseite": REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE,
};

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
    const gelesen = Object.entries(LIGA_KENNTNISNAHMEN).flatMap(([label, fassung]) =>
      daysIn(fassung.absaetze.join(" ")).map((number) => [label, number] as const),
    );

    assert.ok(gelesen.length > 0, "no stored wording states a day count, so this case compares nothing");
    for (const [label, number] of gelesen) {
      assert.equal(
        number,
        STAMPED_CLOCK[label] ?? BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
        `${label} states a deletion clock no bound of its flow sets`,
      );
    }
  });
});
