import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySeatPresence,
  applySharedSeat,
  describeUnrestorableKontakte,
  emptiedSeatLabels,
  mirroredJudgedPaths,
  mirrorKontakte,
  resolveTeamSaisonMembership,
  teamPageHref,
} from "./utils";

import type { FLKontaktperson, FLTeamMembership } from "@/features/teams/schemas";
import type { KontaktpersonDraft, SaisonTeamKontakteDraft } from "@/features/teams/types";

const person = (overrides: Partial<KontaktpersonDraft> = {}): KontaktpersonDraft => ({
  vorname: "Erika",
  nachname: "Mustermann",
  email: "erika@beispiel.de",
  telefon: "069 1234567",
  geburtsdatum: "1990-01-01",
  einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "2025-08", datum: "2025-09-01" },
  ...overrides,
});

/** Three DIFFERENT people, so a seat written over the wrong one shows up rather than reading as a no-op. */
const block = (overrides: Partial<SaisonTeamKontakteDraft> = {}): SaisonTeamKontakteDraft => ({
  trainer: person(),
  ansprechperson: person({ vorname: "Max", email: "max@beispiel.de", telefon: "069 7654321", geburtsdatum: "1985-05-05" }),
  stellvertretung: person({ vorname: "Lena", email: "lena@beispiel.de" }),
  trainer_ist_zugleich: null,
  ...overrides,
});

describe("mirrorKontakte", () => {
  /* The named seat is the SOURCE and the Trainer the reading. Run the other way and into state, a
     keystroke overwrote a second real person's name, number and date of birth while the claim denied
     any link. */
  it("fills the trainer from the seat the claim names", () => {
    const draft = block({ trainer_ist_zugleich: "ansprechperson" });
    const mirrored = mirrorKontakte(draft);

    assert.deepEqual(mirrored.trainer, draft.ansprechperson);
    assert.equal(mirrored.trainer?.vorname, "Max");
    // ONE record in two seats rather than two kept in step, which is what stops them drifting.
    assert.equal(mirrored.trainer, mirrored.ansprechperson);
  });

  /* The claim reaches EITHER seat, so a mirror pinned to the Ansprechperson would leave a Trainer who
     is also the Stellvertretung reading a different person. */
  it("fills the trainer from the Stellvertretung seat where the claim names that one", () => {
    const mirrored = mirrorKontakte(block({ trainer_ist_zugleich: "stellvertretung" }));

    assert.equal(mirrored.trainer, mirrored.stellvertretung);
    assert.equal(mirrored.ansprechperson?.vorname, "Max", "the seat the claim does not name was touched");
  });

  it("leaves every seat untouched while the claim names nobody", () => {
    const draft = block();
    const mirrored = mirrorKontakte(draft);

    assert.deepEqual(mirrored.trainer, draft.trainer);
    assert.deepEqual(mirrored.ansprechperson, draft.ansprechperson);
    assert.notDeepEqual(mirrored.trainer, draft.ansprechperson);
  });

  /* The whole reason this is composed and not stored: the draft keeps the Trainer's OWN person while
     a claim stands, so lifting the claim gives it back rather than handing over a copy. */
  it("leaves the draft's own trainer standing, so lifting the claim returns it", () => {
    const draft = block({ trainer_ist_zugleich: "ansprechperson" });

    assert.equal(mirrorKontakte(draft).trainer?.vorname, "Max", "the composed payload does not read the named seat");
    assert.equal(draft.trainer?.vorname, "Erika", "composing overwrote the draft's own trainer");
    assert.equal(mirrorKontakte({ ...draft, trainer_ist_zugleich: null }).trainer?.vorname, "Erika");
  });

  /* An empty named seat under a standing claim empties the Trainer with it: that seat IS the trainer,
     so "nobody" is what the Trainer reads. */
  it("empties the trainer where the seat the claim names holds nobody", () => {
    assert.equal(mirrorKontakte(block({ ansprechperson: null, trainer_ist_zugleich: "ansprechperson" })).trainer, null);
    assert.notEqual(mirrorKontakte(block({ ansprechperson: null })).trainer, null);
  });
});

describe("applySeatPresence", () => {
  /* Re-judged on the way OUT only. A seat just switched on holds fields nobody has typed in, and a
     message over those describes a value nobody finished entering. */
  it("re-judges the seats a switch emptied and never the ones it opened", () => {
    assert.equal(applySeatPresence(block(), "trainer", false).revalidate, true);
    assert.equal(applySeatPresence(block({ trainer: null }), "trainer", true).revalidate, false);
    assert.equal(applySeatPresence(block(), "stellvertretung", false).revalidate, true);
    assert.equal(applySeatPresence(block({ stellvertretung: null }), "stellvertretung", true).revalidate, false);
  });

  it("empties the seat it is given and opens a blank person in it", () => {
    assert.equal(applySeatPresence(block(), "stellvertretung", false).next.stellvertretung, null);

    const opened = applySeatPresence(block({ trainer: null }), "trainer", true).next;
    assert.equal(opened.trainer?.vorname, "");
    assert.equal(opened.trainer?.einwilligung.erteilt_von, null);
  });

  /* The switch moves ITS OWN seat and nothing else. The claim is honoured when the payload is
     composed, so a switch that also moved the mirrored seat would write into the draft the very
     overwrite composing exists to avoid. */
  it("reaches no seat beside its own, claim or no claim", () => {
    const shared = applySeatPresence(block({ trainer_ist_zugleich: "ansprechperson" }), "trainer", false).next;
    assert.equal(shared.trainer, null);
    assert.equal(shared.ansprechperson?.vorname, "Max", "emptying the Trainer emptied the seat the claim names");

    const alone = applySeatPresence(block(), "trainer", false).next;
    assert.equal(alone.trainer, null);
    assert.equal(alone.ansprechperson?.vorname, "Max");
    assert.equal(alone.stellvertretung?.vorname, "Lena");
  });

  /* What the composed payload does with it: the Trainer reads the named seat, so emptying that seat
     is what empties the Trainer — through `mirrorKontakte`, not through the switch. */
  it("empties the composed trainer by emptying the seat the claim names", () => {
    const geleert = applySeatPresence(block({ trainer_ist_zugleich: "ansprechperson" }), "ansprechperson", false).next;

    assert.equal(mirrorKontakte(geleert).trainer, null);
  });
});

describe("applySharedSeat", () => {
  /* The seats never move — the claim is honoured when the payload is composed. What a pick changes is
     WHO the Trainer reads, so every verdict standing at a trainer path judged a different person. */
  it("re-judges wherever the claim moves", () => {
    assert.equal(applySharedSeat(block(), "ansprechperson").revalidate, true, "taking the claim up left the trainer's verdicts standing");
    assert.equal(
      applySharedSeat(block({ trainer_ist_zugleich: "ansprechperson" }), null).revalidate,
      true,
      "lifting the claim left the named seat's verdicts on the trainer",
    );
    assert.equal(
      applySharedSeat(block({ trainer_ist_zugleich: "ansprechperson" }), "stellvertretung").revalidate,
      true,
      "moving the claim between seats left the first seat's verdicts standing",
    );
  });

  /* A pick that changes nothing judges nothing: re-judging there writes a verdict over a value that
     has not moved, which is a message about a field nobody touched. */
  it("re-judges nothing where the claim already named that seat", () => {
    assert.equal(applySharedSeat(block({ trainer_ist_zugleich: "ansprechperson" }), "ansprechperson").revalidate, false);
    assert.equal(applySharedSeat(block(), null).revalidate, false);
  });

  /* The claim and NOTHING else: a pick that also moved a seat would write into the draft the very
     overwrite composing exists to avoid. */
  it("moves the claim and leaves every person standing", () => {
    const on = applySharedSeat(block(), "stellvertretung");

    assert.equal(on.next.trainer_ist_zugleich, "stellvertretung");
    assert.equal(on.next.trainer?.vorname, "Erika", "taking the claim up overwrote the Trainer's own person");
    assert.equal(on.next.stellvertretung?.vorname, "Lena", "the named seat lost its own person");
    assert.equal(on.next.ansprechperson?.vorname, "Max");

    const off = applySharedSeat(block({ trainer_ist_zugleich: "ansprechperson" }), null);

    assert.equal(off.next.trainer_ist_zugleich, null);
    assert.equal(off.next.trainer?.vorname, "Erika", "lifting the claim did not return the Trainer's own person");
    assert.equal(off.next.ansprechperson?.vorname, "Max", "lifting the claim overwrote a second real person");
  });
});

describe("mirroredJudgedPaths", () => {
  /* The trainer's boxes are the only ones a mirrored Ansprechperson's value can be edited through, so
     a judgement that skipped the copy would leave its verdict standing over what the trainer replaced. */
  it("judges the named seat's copy alongside every trainer field while the mirror stands", () => {
    assert.deepEqual(mirroredJudgedPaths(["kontakte.trainer.email"], "ansprechperson"), [
      "kontakte.trainer.email",
      "kontakte.ansprechperson.email",
    ]);
    assert.deepEqual(mirroredJudgedPaths(["kontakte.trainer.einwilligung.datum"], "ansprechperson"), [
      "kontakte.trainer.einwilligung.datum",
      "kontakte.ansprechperson.einwilligung.datum",
    ]);
  });

  /* The copy follows the claim. Pinned to the Ansprechperson, a Trainer who is also the
     Stellvertretung leaves that seat's verdict standing over the value the trainer replaced. */
  it("judges the Stellvertretung's copy where the claim names that seat", () => {
    assert.deepEqual(mirroredJudgedPaths(["kontakte.trainer.email"], "stellvertretung"), [
      "kontakte.trainer.email",
      "kontakte.stellvertretung.email",
    ]);
  });

  it("reaches no second seat with an empty claim, and none from a seat the mirror does not feed", () => {
    assert.deepEqual(mirroredJudgedPaths(["kontakte.trainer.email"], null), ["kontakte.trainer.email"]);
    assert.deepEqual(mirroredJudgedPaths(["kontakte.stellvertretung.email"], "ansprechperson"), ["kontakte.stellvertretung.email"]);
    assert.deepEqual(mirroredJudgedPaths(["kontakte.ansprechperson.email"], "ansprechperson"), ["kontakte.ansprechperson.email"]);
  });
});

describe("emptiedSeatLabels", () => {
  /* Both halves. Without "held somebody before", a pristine form raises the removal warning and the
     confirmation dialog for every seat that was already empty. */
  it("names a seat only where the stored row held somebody and the draft does not", () => {
    assert.deepEqual(emptiedSeatLabels(block(), block({ trainer: null })), ["Trainer"]);
    assert.deepEqual(emptiedSeatLabels(block({ trainer: null }), block({ trainer: null })), []);
    assert.deepEqual(emptiedSeatLabels(block({ trainer: null, stellvertretung: null }), block({ trainer: null, stellvertretung: null })), []);
  });

  /* A block entered for the first time: nothing was stored, so nothing is being removed, and the
     admin has not yet touched a control. */
  it("names nothing where the club recorded nobody at all", () => {
    assert.deepEqual(emptiedSeatLabels(null, block({ trainer: null, ansprechperson: null, stellvertretung: null })), []);
    assert.deepEqual(emptiedSeatLabels(null, null), []);
  });

  it("names every seat the block took with it, in the panel's own order", () => {
    assert.deepEqual(emptiedSeatLabels(block(), null), ["Trainer", "Ansprechperson", "Stellvertretung"]);
  });

  /* The seat the shared-seat claim empties has its own control pressed by nobody, which is why the
     list is read off the two blocks rather than off the controls. */
  it("names the seat the shared-seat claim emptied", () => {
    assert.deepEqual(emptiedSeatLabels(block(), block({ ansprechperson: null })), ["Ansprechperson"]);
  });
});

describe("teamPageHref", () => {
  /* The season rides along, as it does on every other link into a season-scoped admin page: without
     it the club page falls back to a season the admin did not pick. */
  it("carries the selected season into the club page", () => {
    assert.equal(teamPageHref("507f1f77bcf86cd799439011", "2025"), "/admin/teams/507f1f77bcf86cd799439011?saison_id=2025");
  });

  it("encodes the season it is given", () => {
    assert.match(teamPageHref("abc", "20 25"), /\?saison_id=20%2025$/);
  });
});

describe("resolveTeamSaisonMembership", () => {
  /** The STORED shape, whose agreement has an origin: the draft's widened `null` is the editor's. */
  const stored: FLKontaktperson = { ...person(), einwilligung: { ...person().einwilligung, erteilt_von: "person" } };

  const membership = (saison_id: string): FLTeamMembership => ({
    saison_id,
    gruppe: "A",
    austritt: null,
    trikot_farbe: null,
    kontakte: { trainer: stored, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null },
  });

  /* The header names the SELECTED season and a save writes onto that season's row. Falling back to
     the club's first membership opens the editor on another season's three people and then writes
     them onto this one. */
  it("holds no membership where the club does not play the selected season", () => {
    const resolved = resolveTeamSaisonMembership([membership("2023"), membership("2024")], { id: "2025", status: "active" });

    assert.equal(resolved.membership, null);
    assert.equal(resolved.saisonId, "2025");
    assert.equal(resolved.saisonStatus, "active");
  });

  it("holds no membership where the club plays no season at all", () => {
    assert.equal(resolveTeamSaisonMembership([], { id: "2025", status: "future" }).membership, null);
  });

  it("holds the selected season's own row where there is one", () => {
    const resolved = resolveTeamSaisonMembership([membership("2023"), membership("2025")], { id: "2025", status: "past" });

    assert.equal(resolved.membership?.kontakte?.trainer?.vorname, "Erika");
    assert.equal(resolved.saisonStatus, "past");
  });
});

describe("describeUnrestorableKontakte", () => {
  const payload = (kontakte: SaisonTeamKontakteDraft | null) => ({ team_id: "507f1f77bcf86cd799439011", saison_id: "2025", kontakte });

  it("finds nothing to report about a block the write accepts", () => {
    assert.equal(describeUnrestorableKontakte(payload(block())), null);
    assert.equal(describeUnrestorableKontakte(payload(null)), null);
  });

  /* Backend I36 admits a malformed address on READ so a bad row stays repairable. Once it is
     repaired the pre-save block is no legal write, and the shared undo spine can only answer such a
     body with a reload nothing would change. */
  it("names the seats a stored row holds that the write refuses", () => {
    const report = describeUnrestorableKontakte(payload(block({ trainer: person({ email: "nicht-erreichbar" }) })));

    assert.match(report ?? "", /^Der Stand vor dem Speichern hält ungültige Angaben \(Trainer\)/);
    assert.match(report ?? "", /Trage ihn bei Bedarf von Hand ein\.$/);
    // Never the value itself: the report outlives the editor in a toast, and the address is the
    // person's rather than the record's.
    assert.doesNotMatch(report ?? "", /nicht-erreichbar/);
    // The repair a reload would be is the one this exists to replace.
    assert.doesNotMatch(report ?? "", /Lade die Seite neu/);
  });

  it("names every refused seat and no seat the write accepts", () => {
    const report = describeUnrestorableKontakte(
      payload(block({ trainer: person({ telefon: "!!!" }), stellvertretung: person({ email: "auch-nicht" }) })),
    );

    assert.match(report ?? "", /\(Trainer, Stellvertretung\)/);
  });
});

describe("what a seat's switch does to what was entered", () => {
  /* A switch is not a delete. Rebuilt from `buildEmptyKontaktperson`, turning a seat off and on again
     threw away everything the admin had typed into it, with no undo and no warning. */
  it("gives the person back when the seat is switched on again", () => {
    const erika = person({ vorname: "Erika", email: "erika@beispiel.de" });
    const voll = block({ ansprechperson: erika });

    const aus = applySeatPresence(voll, "ansprechperson", false);
    assert.equal(aus.next.ansprechperson, null, "switching a seat off no longer empties it");

    const wieder = applySeatPresence(aus.next, "ansprechperson", true, erika);
    assert.deepEqual(wieder.next.ansprechperson, erika, "the seat came back with something other than the person it held");
  });

  /* A seat that has never held anybody has nothing to give back, and must still open as three empty
     boxes rather than as whatever another seat left behind. */
  it("opens an untouched seat empty", () => {
    const leer = applySeatPresence(block({ ansprechperson: null }), "ansprechperson", true);

    assert.notEqual(leer.next.ansprechperson, null, "switching an empty seat on left it holding nobody");
    assert.equal(leer.next.ansprechperson?.vorname, "", "an untouched seat opened holding somebody's name");
  });

  /* Re-judged on the way to empty only: a seat just switched back on holds values the admin entered
     and has not left again, and a message over one of those describes a value nobody finished. */
  it("re-judges the seats only on the way to empty", () => {
    assert.equal(applySeatPresence(block({}), "ansprechperson", false).revalidate, true);
    assert.equal(applySeatPresence(block({ ansprechperson: null }), "ansprechperson", true).revalidate, false);
  });
});
