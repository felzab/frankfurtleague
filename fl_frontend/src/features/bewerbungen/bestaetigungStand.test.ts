import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bestaetigungsStand, endstand, gepaarteSitze, istOffen, linkAngebot, zusageHindernis } from "./bestaetigungStand.ts";

import type { KontaktRolle } from "@/features/teams/constants";
import type { SitzBestaetigung } from "./bestaetigungStand.ts";
import type { FLBewerbung, FLBewerbungBestaetigung } from "./schemas.ts";

type Sitze = Pick<FLBewerbung, "bestaetigungen" | "kontakte">;
type Person = FLBewerbung["kontakte"]["trainer"];

/** A seat whose person answered on `bestaetigtAm`, or has not answered at all where that is null. */
function person(vorname: string, bestaetigtAm: string | null): Person {
  return {
    vorname: vorname,
    nachname: "Meier",
    email: `${vorname.toLowerCase()}@schule.example`,
    telefon: "069 1234567",
    geburtsdatum: bestaetigtAm === null ? null : "1988-04-02",
    einwilligung: {
      umfang: "kontaktdaten",
      erteilt_von: bestaetigtAm === null ? "administrativ" : "person",
      text_version: "2026-09-bestaetigungsseite",
      datum: "2026-09-01",
      bestaetigt_am: bestaetigtAm,
    },
  };
}

/** A club the application names, so a case about seats is not answered by the club rule ahead of them. */
const TEAM = "Lessing-Kolleg";

const OFFEN: FLBewerbungBestaetigung = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null };
const ABGELEHNT: FLBewerbungBestaetigung = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: "2026-09-04" };

/** Three seats, each named by the state it is in, so a case says its own fixture. */
function sitze({
  ansprechperson = person("Anna", null),
  stellvertretung = person("Bernd", null),
  trainer = person("Clara", null),
  zugleich = null,
  bestaetigungen = { ansprechperson: OFFEN, stellvertretung: OFFEN, trainer: OFFEN },
}: {
  ansprechperson?: Person;
  stellvertretung?: Person;
  trainer?: Person;
  zugleich?: "ansprechperson" | "stellvertretung" | null;
  bestaetigungen?: Sitze["bestaetigungen"];
} = {}): Sitze {
  return {
    kontakte: {
      ansprechperson: ansprechperson,
      stellvertretung: stellvertretung,
      trainer: trainer,
      trainer_ist_zugleich: zugleich,
    },
    bestaetigungen: bestaetigungen,
  };
}

/** The three seats a case built, or the failure that the block it was given carried none. */
function staendeOf(bewerbung: Sitze): SitzBestaetigung[] {
  const staende = bestaetigungsStand(bewerbung);

  assert.ok(staende !== null, "the fixture carries no confirmation block, so nothing below is judged");
  return staende;
}

const sitzOf = (staende: readonly SitzBestaetigung[], rolle: KontaktRolle): SitzBestaetigung =>
  staende.find((sitz) => sitz.rolle === rolle) ?? assert.fail(`no seat for ${rolle}`);

/* The erasure's own shape (`fl_backend/app/api/kontakte/services.py :: build_clearing_update`): the
   slot and the bookkeeping entry beside it are nulled in one update. */
const ERASED = sitze({
  ansprechperson: null,
  bestaetigungen: { ansprechperson: null, stellvertretung: OFFEN, trainer: OFFEN },
});

describe("a seat an erasure emptied", () => {
  /* `seat_is_answered` returns true on a seat with no bookkeeping entry, so the re-send endpoint
     refuses it; reading the state as `ausstehend` armed a control for a press it would refuse. */
  it("is its own terminal state rather than an outstanding one", () => {
    const sitz = sitzOf(staendeOf(ERASED), "ansprechperson");

    assert.equal(sitz.stand.art, "geloescht");
    assert.equal(sitz.satz, "Keine Bestätigung mehr möglich");
    assert.equal(sitz.name, null);
  });

  /* A declined seat and an erased one are both empty, and the row has to say which happened: one
     person refused, the other asked to be forgotten, and the league did different things. */
  it("says how it came to be empty, and not merely that it is", () => {
    const declined = sitze({
      ansprechperson: null,
      bestaetigungen: { ansprechperson: ABGELEHNT, stellvertretung: OFFEN, trainer: OFFEN },
    });

    assert.equal(sitzOf(staendeOf(ERASED), "ansprechperson").nameSatz, "Auf eigenen Wunsch gelöscht");
    assert.equal(sitzOf(staendeOf(declined), "ansprechperson").nameSatz, "Niemand mehr in der Bewerbung");
    assert.equal(sitzOf(staendeOf(ERASED), "trainer").nameSatz, "Clara Meier");
  });

  /* The count is over the seats that have CONFIRMED, and an erased seat has not: „1 von 3“ over a
     row nobody can complete is still the true count of what the acceptance is waiting for. */
  it("counts as open, so the acceptance stays closed against it", () => {
    const staende = staendeOf(ERASED);

    assert.equal(staende.filter(istOffen).length, 3);
    assert.equal(istOffen(sitzOf(staende, "ansprechperson")), true);
  });

  it("is offered no link, no link being mintable for it", () => {
    assert.deepEqual([...linkAngebot(staendeOf(ERASED))].sort(), ["stellvertretung", "trainer"]);
  });

  /* The decline's own closure: both leave a role with nobody in it, and neither can be waited out,
     so the page must not promise a confirmation over either. */
  it("closes the Zusage the way a decline closes it", () => {
    const declined = sitze({
      ansprechperson: null,
      bestaetigungen: { ansprechperson: ABGELEHNT, stellvertretung: OFFEN, trainer: OFFEN },
    });

    assert.equal(zusageHindernis(staendeOf(ERASED), TEAM), zusageHindernis(staendeOf(declined), TEAM));
    assert.equal(zusageHindernis(staendeOf(ERASED), TEAM), "Wo für eine Rolle niemand mehr in der Bewerbung steht, bleibt nur die Absage.");
  });
});

describe("what a seat's own refusal is called", () => {
  const DECLINED = sitze({
    ansprechperson: null,
    bestaetigungen: { ansprechperson: ABGELEHNT, stellvertretung: OFFEN, trainer: OFFEN },
  });

  /* „Abgelehnt am …“ beside the status „Abgelehnt“ put a seat's refusal and the league's own
     decision on the queue under one root, which is the pair the Widerspruch ruling separates. */
  it("names it with the queue badge's word rather than the application status's", () => {
    const sitz = sitzOf(staendeOf(DECLINED), "ansprechperson");

    assert.equal(sitz.satz, "Widersprochen am 04.09.2026");
    assert.ok(!sitz.satz.includes("Abgelehnt"), "a seat's refusal is called what the league calls its own decision");
  });

  /* The strip's row and the queue's chip are one word in two positions, the participle where a day
     follows it and the noun where the chip stands alone; two roots would read as two states. */
  it("shares that word with the chip the queue shows for the same row", () => {
    assert.equal(endstand(staendeOf(DECLINED)), "Widerspruch");
    assert.match(sitzOf(staendeOf(DECLINED), "ansprechperson").satz, /^Widerspr/);
  });
});

describe("what the queue says of an application no answer can complete", () => {
  const DECLINED = sitze({
    ansprechperson: null,
    bestaetigungen: { ansprechperson: ABGELEHNT, stellvertretung: OFFEN, trainer: OFFEN },
  });

  /* „2 von 3 bestätigt“ over a row whose third seat is gone sends an administrator waiting for an
     answer nobody can give. Both terminal states take the count's place, each in its own word. */
  it("names the state that ended it rather than counting towards an answer", () => {
    assert.equal(endstand(staendeOf(ERASED)), "Eintrag gelöscht");
    assert.equal(endstand(staendeOf(DECLINED)), "Widerspruch");
  });

  /* One chip per row, so a row carrying both has to choose: the decline is the state an
     administrator resolves, where an erasure is one the league made and cannot take back. */
  it("leads with the decline where a row carries both", () => {
    const beides = sitze({
      ansprechperson: null,
      stellvertretung: null,
      bestaetigungen: { ansprechperson: null, stellvertretung: ABGELEHNT, trainer: OFFEN },
    });

    assert.equal(endstand(staendeOf(beides)), "Widerspruch");
  });

  it("says nothing of a row an answer can still complete", () => {
    assert.equal(endstand(staendeOf(sitze())), null);
    assert.equal(
      endstand(
        staendeOf(
          sitze({
            ansprechperson: person("Anna", "2026-09-02"),
            stellvertretung: person("Bernd", "2026-09-03"),
            trainer: person("Clara", "2026-09-03"),
          }),
        ),
      ),
      null,
    );
  });
});

describe("the reason the Zusage is closed", () => {
  /* The rule and not today's list: the strip above names every seat and its state, so a second
     reading of the same rows is one fact from two sides. */
  it("states the rule rather than naming who is outstanding", () => {
    const staende = staendeOf(sitze({ stellvertretung: person("Bernd", "2026-09-03") }));
    const satz = zusageHindernis(staende, TEAM);

    assert.equal(satz, "Eine Zusage ist ohne alle Einwilligungen nicht möglich.");
    // A name in it would move with the seats, which is what makes it a list rather than a rule.
    assert.ok(!satz.includes("Meier"), "the reason names a person, so it reads as a list of today's outstanding seats");
  });

  /* One person on two seats, and a seat whose person has answered: neither moves the sentence, which
     is the whole of what „the rule rather than the situation“ buys. */
  it("says the same thing whichever seats are outstanding", () => {
    const doppelt = person("Anna", null);
    const paar = staendeOf(sitze({ ansprechperson: doppelt, trainer: doppelt, zugleich: "ansprechperson" }));

    assert.equal(zusageHindernis(paar, TEAM), zusageHindernis(staendeOf(sitze()), TEAM));
  });

  /* `REQ-BEWERBUNG-002` is judged before `REQ-BEWERBUNG-013`, so the reason under the control is
     the one the write would answer with rather than the first one this page happens to find. */
  it("answers the row naming no club before it answers a seat", () => {
    assert.match(zusageHindernis(staendeOf(ERASED), null) ?? "", /^Ohne eine neue Schule/);
  });

  it("closes nothing once every seat has confirmed", () => {
    const alle = sitze({
      ansprechperson: person("Anna", "2026-09-02"),
      stellvertretung: person("Bernd", "2026-09-03"),
      trainer: person("Clara", "2026-09-03"),
    });

    assert.equal(zusageHindernis(staendeOf(alle), TEAM), null);
  });

  /* An application stored before the flow reaches no per-seat state, and closing the acceptance on
     that absence would make every queued application undecidable in the deploy that shipped it. */
  it("closes nothing where the application carries no confirmation block", () => {
    assert.equal(zusageHindernis(null, TEAM), null);
  });
});

describe("the two seats one person holds", () => {
  const doppelt = person("Anna", null);
  const PAAR = sitze({ ansprechperson: doppelt, trainer: doppelt, zugleich: "ansprechperson" });

  /* One answer writes both seats (`fl_backend/app/api/bewerbungen/einwilligung_router.py`), so two
     controls would put two messages in one mailbox over one decision. */
  it("are offered one link, on the Trainer's own row", () => {
    assert.deepEqual([...linkAngebot(staendeOf(PAAR))].sort(), ["stellvertretung", "trainer"]);
  });

  /* Where the Trainer's own seat can take no link, the claim must not silence the seat that can:
     the pair would then have no control at all. */
  it("keep the paired row's link where the Trainer's seat is gone", () => {
    const trainerWeg = sitze({
      ansprechperson: doppelt,
      trainer: null,
      zugleich: "ansprechperson",
      bestaetigungen: { ansprechperson: OFFEN, stellvertretung: OFFEN, trainer: null },
    });

    assert.deepEqual([...linkAngebot(staendeOf(trainerWeg))].sort(), ["ansprechperson", "stellvertretung"]);
  });

  /* The message names both, because the answer covers both: a reader told only „Trainerin oder
     Trainer“ would look for a second link for the seat they also hold. */
  it("are both named by the link either row mints", () => {
    assert.deepEqual(gepaarteSitze(PAAR, "trainer"), ["ansprechperson", "trainer"]);
    assert.deepEqual(gepaarteSitze(PAAR, "ansprechperson"), ["ansprechperson", "trainer"]);
    assert.deepEqual(gepaarteSitze(PAAR, "stellvertretung"), ["stellvertretung"]);
  });

  /* `paired_seat`'s `seat_stands` half: a dotted `$set` under a null slot aborts the transaction,
     so the backend drops such a partner and the message must not name it either. */
  it("fall apart where the partner seat has been emptied", () => {
    const halb = sitze({
      ansprechperson: null,
      trainer: doppelt,
      zugleich: "ansprechperson",
      bestaetigungen: { ansprechperson: null, stellvertretung: OFFEN, trainer: OFFEN },
    });

    assert.deepEqual(gepaarteSitze(halb, "trainer"), ["trainer"]);
  });

  it("are one seat where no claim was made", () => {
    assert.deepEqual(gepaarteSitze(sitze(), "trainer"), ["trainer"]);
  });
});

describe("an application stored before the confirmation flow", () => {
  /* An absent block is „nothing to confirm“ rather than three open seats, which is what keeps every
     queued application acceptable in the deploy that shipped the flow. */
  it("reaches no per-seat state at all", () => {
    assert.equal(bestaetigungsStand(sitze({ bestaetigungen: null })), null);
  });
});
