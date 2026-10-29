import { describe, expect, it } from "vitest";

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
  it("carries a row for every referee field", () => {
    const status = deriveSchiedsrichterDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });

    expect(status.fields.length).toBe(5);
  });

  it("reports each field under its own descriptor path, so a mistyped path cannot pass unnoticed", () => {
    for (const [path, draft] of oneFieldChanged) {
      const status = deriveSchiedsrichterDraftStatus({ stored, draft, fieldErrors: {} });

      expect(
        status.changed.map((field) => field.path),
        `changing ${path} should report that path and no other`,
      ).toStrictEqual([path]);
    }
  });

  it("gives every draft field a row, so a field added to the type cannot arrive without one", () => {
    const status = deriveSchiedsrichterDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });
    const covered = new Set(status.fields.map((field) => field.path.split(".")[0]));

    expect([...covered].sort()).toStrictEqual(Object.keys(stored).sort());
  });

  it("reads a cleared optional as a removal rather than as an empty string", () => {
    const draft = { ...stored, kontakt: { ...stored.kontakt, telefon: "" } };
    const status = deriveSchiedsrichterDraftStatus({ stored, draft, fieldErrors: {} });

    // The empty string becomes `null` in this table's own `read`, which is what renders a removal.
    expect(status.byPath.get("kontakt.telefon")?.draftText).toBe(null);
  });

  it("keeps a whitespace-only edit visible, because nothing trims before the save", () => {
    const status = deriveSchiedsrichterDraftStatus({ stored, draft: { ...stored, name: " Klaus Meier " }, fieldErrors: {} });

    // Both spaces survive because this table's `read` is `emptyAsNull`, which trims nothing.
    expect(status.byPath.get("name")?.draftText).toBe(" Klaus Meier ");
  });

  it("carries a field error onto its own row", () => {
    const status = deriveSchiedsrichterDraftStatus({
      stored,
      draft: { ...stored, kontakt: { ...stored.kontakt, email: "keine-mail" } },
      fieldErrors: { "kontakt.email": "Bitte gib eine gültige E-Mail-Adresse ein." },
    });

    // The descriptor's default `errorPaths`, which is this table's: widen it and the message
    // answers on a path no input carries.
    expect(status.byPath.get("kontakt.email")?.error).toBe("Bitte gib eine gültige E-Mail-Adresse ein.");
  });

  it("groups the rows as the editor renders them", () => {
    const status = deriveSchiedsrichterDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });

    expect(status.fields.map((field) => field.group)).toStrictEqual(["Person", "Person", "Kontakt", "Kontakt", "Honorar"]);
  });
});
