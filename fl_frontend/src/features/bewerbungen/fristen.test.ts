import { assert, describe, it } from "vitest";

import { BEWERBUNG_BESTAETIGUNG_FRIST_TAGE, BEWERBUNG_ERINNERUNG_TAGE } from "./constants.ts";

import type { Mail } from "@/core/emailShell.ts";
import type { FLBewerbungLinkDaten } from "@/core/generated/client/types";

const {
  buildBewerbungBestaetigungEmail,
  buildBewerbungEingangEmail,
  buildBewerbungErinnerungEmail,
  buildBewerbungGeloeschtEmail,
  buildBewerbungWiderspruchEmail,
} = await import("@/core/bewerbungEmail.ts");
const { renderMail } = await import("@/core/emailShell.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

/** Not a token, and not shaped like one: a fixture a reader could mistake for a credential is one somebody copies. */
const LINK = { origin: ORIGIN, token: "beispiel-eins" };
const FRIST = "2026-09-18";

const AUSSTEHEND = [{ vorname: "Jonas", rollen: ["trainer" as const] }];

const EIN_SITZ: Omit<FLBewerbungLinkDaten, "art"> = {
  saison_id: "2627",
  schule: "Ernst-Reuter-Schule",
  rollen: ["ansprechperson"],
  frist: FRIST,
};

const MESSAGES = [
  ["the link mail", buildBewerbungBestaetigungEmail({ ...EIN_SITZ, art: "bewerbung_bestaetigung" }, LINK)],
  ["the reminder", buildBewerbungErinnerungEmail({ ...EIN_SITZ, art: "bewerbung_erinnerung" }, LINK)],
  [
    "the receipt",
    buildBewerbungEingangEmail(
      { art: "bewerbung_eingang", saison_id: "2627", rollen: ["ansprechperson"], ausstehend: AUSSTEHEND, frist: FRIST },
      LINK,
    ),
  ],
  [
    "the deletion notice",
    buildBewerbungGeloeschtEmail(
      { art: "bewerbung_loeschung", saison_id: "2627", rollen: ["ansprechperson"], ausstehend: AUSSTEHEND },
      { origin: ORIGIN },
    ),
  ],
  [
    "the seat's decline notice",
    buildBewerbungWiderspruchEmail(
      {
        art: "bewerbung_widerspruch",
        saison_id: "2627",
        rollen: ["ansprechperson"],
        abgelehnt: { vorname: "Mira", rollen: ["stellvertretung"] },
        frist: FRIST,
      },
      { origin: ORIGIN },
    ),
  ],
] as const;

/** German writes a small count in words, so „drei Tage“ is as much a clock as „14 Tage“ is. */
const NUMBER_WORD: Readonly<Record<string, number>> = { drei: 3, sieben: 7, vierzehn: 14 };

/** Every day count a text states, and `null` for one written in a word this reader does not hold. */
function daysIn(text: string): (number | null)[] {
  // Letters and digits alone: the markup puts a `>` against the number, and a non-whitespace run
  // would carry the whole opening tag into the token.
  return [...text.matchAll(/([\p{L}\d]+)\s+Tage[n]?\b/gu)].map((treffer) => {
    const word = (treffer[1] ?? "").toLowerCase();

    return /^\d+$/.test(word) ? Number(word) : (NUMBER_WORD[word] ?? null);
  });
}

const readLink = (mail: Mail): (number | null)[] => {
  const { html, text } = renderMail(mail);
  return daysIn(`${html} ${text}`);
};

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
});
