import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveTeamDraftStatus } from "./teamDraftStatus";

import type { FLTeamDraftFields } from "./teamDraftStatus";
import type { KontaktpersonDraft } from "./types";

/** One junction row, so a case names only the part it is about. */
const membership = (overrides: Partial<NonNullable<FLTeamDraftFields["membership"]>> = {}): FLTeamDraftFields["membership"] => ({
  gruppe: "A",
  austritt: null,
  trikot_farbe: null,
  kontakte: null,
  ...overrides,
});

const person = (overrides: Partial<KontaktpersonDraft> = {}): KontaktpersonDraft => ({
  vorname: "Erika",
  nachname: "Mustermann",
  email: "erika@beispiel.de",
  telefon: "069 1234567",
  geburtsdatum: "1990-01-01",
  einwilligung: { umfang: "kontaktdaten", erteilt_von: "person", text_version: "2025-08", datum: "2025-09-01" },
  ...overrides,
});

const stored: FLTeamDraftFields = {
  name: "Helmholtz",
  shorthand: "HH",
  full_name: "Helmholtzschule Frankfurt am Main",
  website_url: "https://www.helmholtzschule.de",
  description: "Eine Schule.",
  address: { strasse: "Habsburgerallee", hausnummer: "57", plz: "60385", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
  schulform: "gymnasium_g9",
  membership: membership(),
};

const draftFrom = (overrides: Partial<FLTeamDraftFields>): FLTeamDraftFields => ({ ...stored, ...overrides });

describe("deriveTeamDraftStatus", () => {
  it("reports a clean draft as not dirty, with every field present", () => {
    const status = deriveTeamDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    assert.equal(status.isDirty, false);
    assert.equal(status.changed.length, 0);
    // Every club field plus every junction row, the contact seats included: each is graded on the
    // membership, so none of them appears or disappears with the value it reports.
    assert.equal(status.fields.length, 21);
  });

  it("reports a renamed club as one change carrying both texts", () => {
    const status = deriveTeamDraftStatus({ stored, draft: draftFrom({ name: "Helmholtz II" }), fieldErrors: {} });

    assert.equal(status.isDirty, true);
    assert.deepEqual(
      status.changed.map((field) => [field.path, field.storedText, field.draftText]),
      [["name", "Helmholtz", "Helmholtz II"]],
    );
  });

  it("treats an emptied optional field as removed rather than changed-to-empty-string", () => {
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ address: { ...stored.address, stadtteil: "" } }),
      fieldErrors: {},
    });

    const row = status.byPath.get("address.stadtteil");
    assert.ok(row?.isChanged);
    // `draftText: null` is what makes the change list render this as a removal.
    assert.equal(row.draftText, null);
    assert.equal(row.storedText, "Ostend");
  });

  it("formats an entered austritt with its route, reason and formatted date", () => {
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ membership: membership({ austritt: { type: "rueckzug", grund: "Schule aufgelöst", datum: "2026-03-14" } }) }),
      fieldErrors: {},
    });

    const row = status.byPath.get("austritt");
    assert.ok(row?.isChanged);
    assert.equal(row.storedText, null);
    assert.match(row.draftText ?? "", /^Rückzug: Schule aufgelöst \(ab 14\./);
  });

  it("sees a route swapped on an otherwise identical record as a change", () => {
    const record = { grund: "Nicht angetreten", datum: "2026-03-14" } as const;
    const status = deriveTeamDraftStatus({
      stored: { ...stored, membership: membership({ austritt: { type: "disqualifikation", ...record } }) },
      draft: draftFrom({ membership: membership({ austritt: { type: "rueckzug", ...record } }) }),
      fieldErrors: {},
    });

    assert.equal(status.byPath.get("austritt")?.isChanged, true);
  });

  it("drops every membership row while the club is not in the selected season", () => {
    const noMembership = draftFrom({ membership: null });
    const status = deriveTeamDraftStatus({ stored: noMembership, draft: noMembership, fieldErrors: {} });

    assert.equal(status.fields.length, 11);
    assert.equal(status.byPath.has("gruppe"), false);
    assert.equal(status.byPath.has("austritt"), false);
    assert.equal(status.byPath.has("trikot_farbe"), false);
    assert.equal(status.byPath.has("kontakte.trainer"), false);
  });

  it("finds an austritt error under any of the record's four paths", () => {
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ membership: membership({ austritt: { type: "disqualifikation", grund: "", datum: "2026-03-14" } }) }),
      fieldErrors: { "austritt.grund": "Bitte gib einen Grund an." },
    });

    const row = status.byPath.get("austritt");
    assert.equal(row?.error, "Bitte gib einen Grund an.");
    assert.deepEqual(
      status.invalid.map((field) => field.path),
      ["austritt"],
    );
  });

  it("finds the unpicked route under its own path, and renders the record as still open", () => {
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ membership: membership({ austritt: { type: null, grund: "Nicht angetreten", datum: "2026-03-14" } }) }),
      fieldErrors: { "austritt.type": "Bitte wähle, wie das Team ausgeschieden ist." },
    });

    const row = status.byPath.get("austritt");
    assert.equal(row?.error, "Bitte wähle, wie das Team ausgeschieden ist.");
    assert.match(row?.draftText ?? "", /^Art offen: /);
  });

  it("adds a row per contact seat and one for the shared-seat flag once contacts are on file", () => {
    const kontakte = {
      trainer: person(),
      ansprechperson: person(),
      stellvertretung: person({ vorname: "Max" }),
      trainer_ist_ansprechperson: true,
    };
    const withKontakte = draftFrom({ membership: membership({ kontakte }) });
    const status = deriveTeamDraftStatus({ stored: withKontakte, draft: withKontakte, fieldErrors: {} });

    assert.equal(status.fields.length, 21);
    assert.equal(status.isDirty, false);
    assert.equal(status.byPath.get("kontakte.trainer")?.draftText, "Erika Mustermann, erika@beispiel.de, 069 1234567, geboren am 01.01.1990");
    assert.equal(status.byPath.get("kontakte.trainer.einwilligung")?.draftText, "Von der Person selbst, Fassung 2025-08 (ab 01.09.2025)");
    assert.equal(status.byPath.get("kontakte.trainer_ist_ansprechperson")?.draftText, "Ja");
  });

  /* Why these rows are graded on the membership: keyed on `kontakte` itself, every row reporting the
     loss is filtered out before the comparison, and a withdrawn consent cannot be executed at all. */
  it("reports contacts switched off as a change on every row that held one", () => {
    const kontakte = {
      trainer: person(),
      ansprechperson: person(),
      stellvertretung: person({ vorname: "Max" }),
      trainer_ist_ansprechperson: false,
    };
    const status = deriveTeamDraftStatus({
      stored: draftFrom({ membership: membership({ kontakte }) }),
      draft: draftFrom({ membership: membership({ kontakte: null }) }),
      fieldErrors: {},
    });

    assert.equal(status.isDirty, true);
    assert.deepEqual(status.changed.map((field) => field.path).sort(), [
      "kontakte.ansprechperson",
      "kontakte.ansprechperson.einwilligung",
      "kontakte.stellvertretung",
      "kontakte.stellvertretung.einwilligung",
      "kontakte.trainer",
      "kontakte.trainer.einwilligung",
      "kontakte.trainer_ist_ansprechperson",
    ]);
    // `draftText: null` is what makes the change list render each of these as a removal.
    assert.equal(status.byPath.get("kontakte.trainer")?.draftText, null);
    assert.equal(status.byPath.get("kontakte.trainer")?.storedText?.startsWith("Erika Mustermann"), true);
  });

  it("finds a contact error under the seat that holds the field", () => {
    const kontakte = {
      trainer: person({ email: "" }),
      ansprechperson: person(),
      stellvertretung: person(),
      trainer_ist_ansprechperson: false,
    };
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ membership: membership({ kontakte }) }),
      fieldErrors: { "kontakte.trainer.email": "Bitte gib eine gültige E-Mail-Adresse ein." },
    });

    assert.equal(status.byPath.get("kontakte.trainer")?.error, "Bitte gib eine gültige E-Mail-Adresse ein.");
  });
});
