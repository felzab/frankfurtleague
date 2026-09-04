import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { KONTAKT_ROLLEN, TRAINER_ZUGLEICH_FRAGE, trainerZugleichLabel } from "@/features/teams/constants";

import { deriveKontakteDraftStatus, kontaktSeatPaths } from "./kontakteDraftStatus";

import type { KontaktRolle } from "@/features/teams/constants";
import type { KontaktpersonDraft } from "@/features/teams/types";
import type { FLKontakteDraftFields } from "./kontakteDraftStatus";

const person = (overrides: Partial<KontaktpersonDraft> = {}): KontaktpersonDraft => ({
  vorname: "Erika",
  nachname: "Mustermann",
  email: "erika@beispiel.de",
  telefon: "069 1234567",
  geburtsdatum: "1990-01-01",
  einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "2025-08", datum: "2025-09-01", bestaetigt_am: "2025-09-02" },
  ...overrides,
});

/** One block, so a case names only the seat it is about. */
const block = (overrides: Partial<NonNullable<FLKontakteDraftFields["kontakte"]>> = {}): FLKontakteDraftFields => ({
  kontakte: {
    trainer: person(),
    ansprechperson: person({ vorname: "Max" }),
    stellvertretung: person({ vorname: "Lena" }),
    trainer_ist_zugleich: null,
    ...overrides,
  },
});

const EMPTY: FLKontakteDraftFields = { kontakte: null };

describe("deriveKontakteDraftStatus", () => {
  it("carries a row per seat, a row per agreement, and one for the shared-seat claim", () => {
    const stored = block();
    const status = deriveKontakteDraftStatus({ stored, draft: stored, fieldErrors: {} });

    assert.equal(status.isDirty, false);
    assert.equal(status.fields.length, 7);
    assert.equal(status.byPath.get("kontakte.trainer")?.draftText, "Erika Mustermann, erika@beispiel.de, 069 1234567, geboren am 01.01.1990");
    assert.equal(status.byPath.get("kontakte.trainer.einwilligung")?.draftText, "Von der Person selbst, Fassung 2025-08 (ab 01.09.2025)");
    // Read from the table rather than quoted: the wording is the product's, and pinning it here
    // makes rewording the question read as a regression.
    assert.equal(status.byPath.get("kontakte.trainer_ist_zugleich")?.draftText, trainerZugleichLabel(null));
  });

  /* The rows are unconditional: keyed on `kontakte` itself, every row reporting the loss would be
     filtered out before the comparison, and a withdrawn consent could not be executed at all. */
  it("reports the block switched off as a change on every row that held something", () => {
    const status = deriveKontakteDraftStatus({ stored: block(), draft: EMPTY, fieldErrors: {} });

    assert.equal(status.isDirty, true);
    assert.deepEqual(status.changed.map((field) => field.path).sort(), [
      "kontakte.ansprechperson",
      "kontakte.ansprechperson.einwilligung",
      "kontakte.stellvertretung",
      "kontakte.stellvertretung.einwilligung",
      "kontakte.trainer",
      "kontakte.trainer.einwilligung",
      "kontakte.trainer_ist_zugleich",
    ]);
    // `draftText: null` is what makes the change list render each of these as a removal.
    assert.equal(status.byPath.get("kontakte.trainer")?.draftText, null);
    assert.equal(status.byPath.get("kontakte.trainer")?.storedText?.startsWith("Erika Mustermann"), true);
  });

  /* Why a row is never keyed on the seat it reports: keyed on the person, both rows reporting the
     loss drop out before the comparison, so emptying a seat would read as no change at all, with the
     save button disabled over a real edit. */
  it("reports one seat emptied as a change of its own, the two beside it standing", () => {
    const status = deriveKontakteDraftStatus({ stored: block(), draft: block({ trainer: null }), fieldErrors: {} });

    // Dirty on the seat alone is what makes the emptying saveable without a second edit beside it.
    assert.equal(status.isDirty, true);
    assert.deepEqual(status.changed.map((field) => field.path).sort(), ["kontakte.trainer", "kontakte.trainer.einwilligung"]);
    // The row survives its own value going, and `draftText: null` is what renders it as a removal.
    assert.equal(status.fields.length, 7);
    assert.equal(status.byPath.get("kontakte.trainer")?.draftText, null);
    assert.equal(status.byPath.get("kontakte.ansprechperson")?.isChanged, false);
  });

  it("keeps a row for a seat that was already empty, reading it as nothing", () => {
    const stored = block({ trainer: null });
    const status = deriveKontakteDraftStatus({ stored, draft: stored, fieldErrors: {} });

    assert.equal(status.fields.length, 7);
    assert.equal(status.byPath.get("kontakte.trainer")?.draftText, null);
  });

  it("keeps every row while the club records nobody at all, so the switch back is a change", () => {
    const status = deriveKontakteDraftStatus({ stored: EMPTY, draft: EMPTY, fieldErrors: {} });

    assert.equal(status.isDirty, false);
    assert.equal(status.fields.length, 7);
    assert.equal(status.byPath.get("kontakte.trainer_ist_zugleich")?.draftText, null);
  });

  it("finds a contact error under the seat that holds the field", () => {
    const status = deriveKontakteDraftStatus({
      stored: EMPTY,
      draft: block({ trainer: person({ email: "" }) }),
      fieldErrors: { "kontakte.trainer.email": "Bitte gib eine gültige E-Mail-Adresse ein." },
    });

    assert.equal(status.byPath.get("kontakte.trainer")?.error, "Bitte gib eine gültige E-Mail-Adresse ein.");
    assert.deepEqual(
      status.invalid.map((field) => field.path),
      ["kontakte.trainer"],
    );
  });

  it("finds an unpicked agreement under the agreement's row, and renders it as still open", () => {
    const status = deriveKontakteDraftStatus({
      stored: EMPTY,
      draft: block({
        trainer: person({ einwilligung: { umfang: "kontaktdaten", erteilt_von: null, text_version: "", datum: "", bestaetigt_am: null } }),
      }),
      fieldErrors: { "kontakte.trainer.einwilligung.datum": "Bitte gib an, wann die Einwilligung erteilt wurde." },
    });

    const row = status.byPath.get("kontakte.trainer.einwilligung");
    assert.equal(row?.error, "Bitte gib an, wann die Einwilligung erteilt wurde.");
    // All three fallbacks render rather than hiding: they are the mid-edit states the schema rejects
    // on save, and the change list is where the admin sees what is still missing.
    assert.equal(row?.draftText, "Noch offen, ohne Fassung (ohne Datum)");
  });

  /* A seat holds a person once anybody is recorded in it, and a name is one of the fields that
     person may still be missing. Read as `null` the row renders as a REMOVAL, so a half-filled seat
     would report itself as one nobody sits in. */
  it("renders a seat holding no name as a person still on file", () => {
    const nameless = person({ vorname: "", nachname: "" });
    const status = deriveKontakteDraftStatus({ stored: EMPTY, draft: block({ trainer: nameless }), fieldErrors: {} });

    assert.equal(status.byPath.get("kontakte.trainer")?.draftText, "Ohne Namen, erika@beispiel.de, 069 1234567, geboren am 01.01.1990");
    assert.equal(status.byPath.get("kontakte.trainer")?.isChanged, true);
  });

  /* A seat emptied under a stored name still reads as a removal, which is the state `null` is FOR.
     Both cases in one test: the fallback above may not be bought by losing this one. */
  it("keeps `null` for the seat nobody is recorded in", () => {
    const status = deriveKontakteDraftStatus({ stored: block(), draft: block({ trainer: null }), fieldErrors: {} });

    assert.equal(status.byPath.get("kontakte.trainer")?.draftText, null);
  });

  it("groups each seat's two rows under the seat, and the claim on its own", () => {
    const status = deriveKontakteDraftStatus({ stored: EMPTY, draft: block(), fieldErrors: {} });

    assert.deepEqual(
      status.fields.map((field) => [field.group, field.label]),
      [
        ["Ansprechperson", "Person"],
        ["Ansprechperson", "Einwilligung"],
        ["Stellvertretung", "Person"],
        ["Stellvertretung", "Einwilligung"],
        ["Trainer", "Person"],
        ["Trainer", "Einwilligung"],
        ["Kontakte", TRAINER_ZUGLEICH_FRAGE],
      ],
    );
  });

  /* The rail and the editor's panels both map `KONTAKT_ROLLEN`; a rail keeping its own sequence
     would send an admin to the third card for a change the first one made. */
  it("lists the seats in the order the panels stand in", () => {
    const status = deriveKontakteDraftStatus({ stored: EMPTY, draft: block(), fieldErrors: {} });
    const sitze = [...new Set(status.fields.map((field) => field.group))].filter((gruppe) => gruppe !== "Kontakte");

    assert.deepEqual(
      sitze,
      KONTAKT_ROLLEN.map(({ label }) => label),
      "the rail reads the seats in an order the panels do not",
    );
  });
});

/** Every path a seat could conceivably report under, whether the rows read it or not. */
const candidatePaths = (rolle: KontaktRolle): string[] => [
  `kontakte.${rolle}`,
  `kontakte.${rolle}.vorname`,
  `kontakte.${rolle}.nachname`,
  `kontakte.${rolle}.email`,
  `kontakte.${rolle}.telefon`,
  `kontakte.${rolle}.geburtsdatum`,
  `kontakte.${rolle}.einwilligung`,
  `kontakte.${rolle}.einwilligung.text_version`,
  `kontakte.${rolle}.einwilligung.datum`,
];

/** The paths whose message a row of the change list actually picks up. */
const judgedPaths = (rolle: KontaktRolle): string[] =>
  candidatePaths(rolle).filter(
    (path) => deriveKontakteDraftStatus({ stored: EMPTY, draft: block(), fieldErrors: { [path]: "x" } }).invalid.length > 0,
  );

describe("kontaktSeatPaths", () => {
  /* The whole reason the helper is exported: the editor re-judges exactly this set when a seat goes
     empty, and a path the rows report under but this list omits leaves a verdict nothing ever clears
     — a message pointing at a box that is no longer rendered. */
  it("covers every path the seat's rows report under, and no other", () => {
    for (const { value: rolle } of KONTAKT_ROLLEN) {
      assert.deepEqual([...kontaktSeatPaths(rolle)].sort(), judgedPaths(rolle).sort(), `the list and the rows disagree about ${rolle}`);
    }
  });

  /* The floor under the case above: a filter matching nothing would make both sides empty and the
     comparison would hold over a helper that clears nothing at all. */
  it("names the agreement's own paths beside the person's", () => {
    assert.deepEqual([...kontaktSeatPaths("trainer")].sort(), [
      "kontakte.trainer",
      "kontakte.trainer.einwilligung",
      "kontakte.trainer.einwilligung.datum",
      "kontakte.trainer.einwilligung.text_version",
      "kontakte.trainer.email",
      "kontakte.trainer.geburtsdatum",
      "kontakte.trainer.nachname",
      "kontakte.trainer.telefon",
      "kontakte.trainer.vorname",
    ]);
  });
});
