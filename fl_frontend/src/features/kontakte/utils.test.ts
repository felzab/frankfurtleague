import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applySeatPresence,
  applySharedFlag,
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
  trainer_ist_ansprechperson: false,
  ...overrides,
});

describe("mirrorKontakte", () => {
  /* The whole of what the flag means. Inverted, every keystroke in the Trainer boxes overwrites a
     SECOND real person's name, address, number and date of birth while the flag denies any link. */
  it("copies the trainer into the Ansprechperson seat while the flag stands", () => {
    const draft = block({ trainer_ist_ansprechperson: true });
    const mirrored = mirrorKontakte(draft);

    assert.deepEqual(mirrored.ansprechperson, draft.trainer);
    assert.equal(mirrored.ansprechperson?.vorname, "Erika");
    // ONE record in two seats rather than two kept in step, which is what stops them drifting.
    assert.equal(mirrored.ansprechperson, mirrored.trainer);
  });

  it("leaves the Ansprechperson seat untouched while the flag is down", () => {
    const draft = block();
    const mirrored = mirrorKontakte(draft);

    assert.equal(mirrored.ansprechperson?.vorname, "Max");
    assert.equal(mirrored.ansprechperson?.email, "max@beispiel.de");
    assert.equal(mirrored.ansprechperson?.telefon, "069 7654321");
    assert.equal(mirrored.ansprechperson?.geburtsdatum, "1985-05-05");
    assert.notDeepEqual(mirrored.ansprechperson, draft.trainer);
  });

  /* Typing in the Trainer boxes is the path the defect ships on: every keystroke runs through here,
     so a flag that is down has to leave the second person standing keystroke by keystroke. */
  it("leaves the second person standing when the trainer is edited under a down flag", () => {
    const draft = block();
    const typed = mirrorKontakte({ ...draft, trainer: person({ vorname: "Erik" }) });

    assert.equal(typed.trainer?.vorname, "Erik");
    assert.deepEqual(typed.ansprechperson, draft.ansprechperson);
  });

  /* An empty Trainer seat under a standing flag empties the Ansprechperson seat with it: that seat
     IS the trainer, so "nobody" is what it holds. */
  it("empties the mirrored seat where the trainer holds nobody", () => {
    assert.equal(mirrorKontakte(block({ trainer: null, trainer_ist_ansprechperson: true })).ansprechperson, null);
    assert.notEqual(mirrorKontakte(block({ trainer: null })).ansprechperson, null);
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

  /* The switch runs through the mirror, so emptying the Trainer under a standing flag takes the
     Ansprechperson seat with it — and under a down flag reaches nobody but its own seat. */
  it("carries the mirror, and reaches no seat beside its own without it", () => {
    const shared = applySeatPresence(block({ trainer_ist_ansprechperson: true }), "trainer", false).next;
    assert.equal(shared.trainer, null);
    assert.equal(shared.ansprechperson, null);

    const alone = applySeatPresence(block(), "trainer", false).next;
    assert.equal(alone.trainer, null);
    assert.equal(alone.ansprechperson?.vorname, "Max");
    assert.equal(alone.stellvertretung?.vorname, "Lena");
  });
});

describe("applySharedFlag", () => {
  /* BOTH directions. Switched on, the seat loses its own person for the trainer's or for nobody, and
     a verdict at its paths then judges neither. Its boxes are read-only, so no blur clears one. */
  it("re-judges the seats wherever the mirror moves the Ansprechperson", () => {
    assert.equal(applySharedFlag(block(), true).revalidate, true, "the seat took the trainer's person and kept its verdicts");
    assert.equal(applySharedFlag(block({ trainer: null }), true).revalidate, true, "the seat was emptied and kept its verdicts");
  });

  /* Turning it OFF moves nobody: the seat goes on holding what it copied, and re-judging there would
     write a verdict over a value that has not changed. */
  it("re-judges nothing where the seat holds what it already held", () => {
    assert.equal(applySharedFlag(block({ trainer_ist_ansprechperson: true }), false).revalidate, false);
    assert.equal(applySharedFlag(block({ trainer: null, ansprechperson: null }), true).revalidate, false);
  });

  it("carries the mirror and the flag it was given", () => {
    const on = applySharedFlag(block(), true);

    assert.equal(on.next.trainer_ist_ansprechperson, true);
    assert.equal(on.next.ansprechperson?.vorname, "Erika", "the seat did not take the trainer's person");

    const off = applySharedFlag(block({ trainer_ist_ansprechperson: true }), false);

    assert.equal(off.next.trainer_ist_ansprechperson, false);
    assert.equal(off.next.ansprechperson?.vorname, "Max", "turning the flag off overwrote a second real person");
  });
});

describe("mirroredJudgedPaths", () => {
  /* The trainer's boxes are the only ones a mirrored Ansprechperson's value can be edited through, so
     a judgement that skipped the copy would leave its verdict standing over what the trainer replaced. */
  it("judges the Ansprechperson's copy alongside every trainer field while the mirror stands", () => {
    assert.deepEqual(mirroredJudgedPaths(["kontakte.trainer.email"], true), ["kontakte.trainer.email", "kontakte.ansprechperson.email"]);
    assert.deepEqual(mirroredJudgedPaths(["kontakte.trainer.einwilligung.datum"], true), [
      "kontakte.trainer.einwilligung.datum",
      "kontakte.ansprechperson.einwilligung.datum",
    ]);
  });

  it("reaches no second seat with the flag down, and none from a seat the mirror does not feed", () => {
    assert.deepEqual(mirroredJudgedPaths(["kontakte.trainer.email"], false), ["kontakte.trainer.email"]);
    assert.deepEqual(mirroredJudgedPaths(["kontakte.stellvertretung.email"], true), ["kontakte.stellvertretung.email"]);
    assert.deepEqual(mirroredJudgedPaths(["kontakte.ansprechperson.email"], true), ["kontakte.ansprechperson.email"]);
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

  /* The seat the shared-seat flag empties has its own control pressed by nobody, which is why the
     list is read off the two blocks rather than off the switches. */
  it("names the seat the shared-seat flag emptied", () => {
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
    kontakte: { trainer: stored, ansprechperson: null, stellvertretung: null, trainer_ist_ansprechperson: false },
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
