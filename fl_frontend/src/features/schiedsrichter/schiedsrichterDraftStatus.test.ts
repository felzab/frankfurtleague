import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveSchiedsrichterDraftStatus } from "./schiedsrichterDraftStatus";

import type { FLSchiedsrichterDraftFields } from "./schiedsrichterDraftStatus";

const stored: FLSchiedsrichterDraftFields = {
  name: "Klaus Meier",
  schule: "Helmholtzschule",
  kontakt: { email: "klaus@example.de", telefon: "+49 69 1234567" },
  default_payment: 25,
};

// One row per descriptor: the path it must report, and a draft differing in that field alone.
const oneFieldChanged: readonly (readonly [string, FLSchiedsrichterDraftFields])[] = [
  ["name", { ...stored, name: "Anders Meier" }],
  ["schule", { ...stored, schule: "Musterschule" }],
  ["kontakt.email", { ...stored, kontakt: { ...stored.kontakt, email: "anders@example.de" } }],
  ["kontakt.telefon", { ...stored, kontakt: { ...stored.kontakt, telefon: "+49 69 7654321" } }],
  ["default_payment", { ...stored, default_payment: 30 }],
];

describe("deriveSchiedsrichterDraftStatus", () => {
  it("reports a clean draft as not dirty, with every field present", () => {
    const status = deriveSchiedsrichterDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });

    assert.equal(status.isDirty, false);
    assert.equal(status.changed.length, 0);
    assert.equal(status.fields.length, 5);
  });

  it("reports each field under its own descriptor path, so a mistyped path cannot pass unnoticed", () => {
    for (const [path, draft] of oneFieldChanged) {
      const status = deriveSchiedsrichterDraftStatus({ stored, draft, fieldErrors: {} });

      assert.deepEqual(
        status.changed.map((field) => field.path),
        [path],
        `changing ${path} should report that path and no other`,
      );
    }
  });

  it("gives every draft field a row, so a field added to the type cannot arrive without one", () => {
    const status = deriveSchiedsrichterDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });
    const covered = new Set(status.fields.map((field) => field.path.split(".")[0]));

    assert.deepEqual([...covered].sort(), Object.keys(stored).sort());
  });

  it("reads a cleared optional as a removal rather than as an empty string", () => {
    const draft = { ...stored, schule: null, kontakt: { ...stored.kontakt, telefon: "" } };
    const status = deriveSchiedsrichterDraftStatus({ stored, draft, fieldErrors: {} });

    assert.equal(status.byPath.get("schule")?.draftText, null);
    assert.equal(status.byPath.get("kontakt.telefon")?.draftText, null);
  });

  it("keeps a whitespace-only edit visible, because nothing trims before the save", () => {
    const status = deriveSchiedsrichterDraftStatus({ stored, draft: { ...stored, name: " Klaus Meier " }, fieldErrors: {} });

    assert.equal(status.isDirty, true);
    assert.equal(status.byPath.get("name")?.draftText, " Klaus Meier ");
  });

  it("carries a field error onto its own row and into invalid", () => {
    const status = deriveSchiedsrichterDraftStatus({
      stored,
      draft: { ...stored, kontakt: { ...stored.kontakt, email: "keine-mail" } },
      fieldErrors: { "kontakt.email": "Bitte gib eine gültige E-Mail-Adresse ein." },
    });

    assert.equal(status.byPath.get("kontakt.email")?.error, "Bitte gib eine gültige E-Mail-Adresse ein.");
    assert.deepEqual(
      status.invalid.map((field) => field.path),
      ["kontakt.email"],
    );
  });

  it("groups the rows as the editor renders them", () => {
    const status = deriveSchiedsrichterDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });

    assert.deepEqual(
      status.fields.map((field) => field.group),
      ["Person", "Person", "Kontakt", "Kontakt", "Honorar"],
    );
  });
});
