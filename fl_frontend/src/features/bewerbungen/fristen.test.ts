import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

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
  buildBewerbungAblehnungEmail,
  buildBewerbungBestaetigungEmail,
  buildBewerbungEingangOffenEmail,
  buildBewerbungErinnerungEmail,
  buildBewerbungGeloeschtEmail,
  buildBewerbungVollstaendigEmail,
} = await import("@/core/bewerbungEmail.ts");
const { LIGA_EINWILLIGUNGEN } = await import("@/core/einwilligung.ts");
const { SITE_URL } = await import("@/core/brand.ts");

/** Not a token, and not shaped like one: a fixture a reader could mistake for a credential is one somebody copies. */
const LINK = `${SITE_URL}/bestaetigung?token=beispiel-eins`;
const FRIST = "18.09.2026";

const ERIKA = { vorname: "Erika", rolleText: "Ansprechperson", link: LINK };
const JONAS = { vorname: "Jonas", rolleText: "Trainerin oder Trainer", link: LINK };
const AUSSTEHEND = [{ vorname: "Jonas", rolleText: "Trainerin oder Trainer" }];

const EIN_SITZ = { saisonId: "2627", schule: "Ernst-Reuter-Schule", seats: [ERIKA], fristText: FRIST } satisfies BewerbungBestaetigungData;
/* Both arms of every builder that has two: the plural wording is a second copy of each sentence, and
   only a render of it reads the clock it states. */
const ZWEI_SITZE = { ...EIN_SITZ, seats: [ERIKA, JONAS] } satisfies BewerbungBestaetigungData;

const NACHRICHTEN = [
  ["the link message", buildBewerbungBestaetigungEmail(EIN_SITZ)],
  ["the link message to a shared inbox", buildBewerbungBestaetigungEmail(ZWEI_SITZE)],
  ["the reminder", buildBewerbungErinnerungEmail(EIN_SITZ)],
  ["the reminder to a shared inbox", buildBewerbungErinnerungEmail(ZWEI_SITZE)],
  [
    "the receipt",
    buildBewerbungEingangOffenEmail({ saisonId: "2627", rollenText: "Ansprechperson", ausstehend: AUSSTEHEND, fristText: FRIST, link: LINK }),
  ],
  ["the completeness notice", buildBewerbungVollstaendigEmail({ saisonId: "2627", rollenText: "Ansprechperson" })],
  ["the deletion notice", buildBewerbungGeloeschtEmail({ saisonId: "2627", rollenText: "Ansprechperson", ausstehend: AUSSTEHEND })],
  [
    "the seat's decline notice",
    buildBewerbungAblehnungEmail({
      saisonId: "2627",
      rollenText: "Ansprechperson",
      abgelehnt: { vorname: "Mira", rolleText: "Stellvertretung" },
      fristText: FRIST,
    }),
  ],
] as const;

/** German writes a small count in words, so „drei Tage“ is as much a clock as „14 Tage“ is. */
const ZAHLWORT: Readonly<Record<string, number>> = { drei: 3, vierzehn: 14 };

/** Every day count a text states, and `null` for one written in a word this reader does not hold. */
function tageIn(text: string): (number | null)[] {
  // Letters and digits alone: the markup puts a `>` against the number, and a non-whitespace run
  // would carry the whole opening tag into the token.
  return [...text.matchAll(/([\p{L}\d]+)\s+Tage[n]?\b/gu)].map((treffer) => {
    const wort = (treffer[1] ?? "").toLowerCase();

    return /^\d+$/.test(wort) ? Number(wort) : (ZAHLWORT[wort] ?? null);
  });
}

const gelesen = (mail: { html: string; text: string }): (number | null)[] => tageIn(`${mail.html} ${mail.text}`);

describe("the two clocks the workflow messages state", () => {
  /* First: a set of messages naming no day at all would leave every case below passing over nothing,
     and a builder that stopped stating its clock is exactly what that looks like. */
  it("finds a day count in the messages at all", () => {
    const gefunden = NACHRICHTEN.flatMap(([, mail]) => gelesen(mail));

    assert.ok(gefunden.length >= NACHRICHTEN.length, "the messages state fewer day counts than there are messages");
  });

  it("states no day count but the two the constants set", () => {
    for (const [wer, mail] of NACHRICHTEN) {
      for (const zahl of gelesen(mail)) {
        assert.ok(zahl !== null, `${wer} writes a day count in a word this case cannot read`);
        assert.ok(
          zahl === BEWERBUNG_ERINNERUNG_TAGE || zahl === BEWERBUNG_BESTAETIGUNG_FRIST_TAGE,
          `${wer} states ${String(zahl)} days, which is neither clock`,
        );
      }
    }
  });

  /* Each on its own, so a bound raised to the other's number cannot pass by the set still holding
     two members. */
  it("states each of the two somewhere across them", () => {
    const alle = new Set(NACHRICHTEN.flatMap(([, mail]) => gelesen(mail)));

    assert.ok(alle.has(BEWERBUNG_ERINNERUNG_TAGE), "no message states the reminder's clock");
    assert.ok(alle.has(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE), "no message states the deletion's clock");
  });

  /* The stamped text is never interpolated from the constant: the words are what somebody agreed to,
     so a moved bound has to fail here and be minted as a new label rather than reword this one. */
  it("holds the stamped consent texts to the deletion clock, written in a word", () => {
    const gefunden = Object.values(LIGA_EINWILLIGUNGEN).flatMap((fassung) => tageIn(fassung.absaetze.join(" ")));

    assert.ok(gefunden.length > 0, "no stored wording states a day count, so this case compares nothing");
    for (const zahl of gefunden) {
      assert.equal(zahl, BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, "a stored wording states a deletion clock the bound no longer sets");
    }
  });
});
