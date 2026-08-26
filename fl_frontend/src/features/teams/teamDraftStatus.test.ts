import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveTeamDraftStatus } from "./teamDraftStatus";

import type { FLTeamDraftFields } from "./teamDraftStatus";

const stored: FLTeamDraftFields = {
  name: "Helmholtz",
  shorthand: "HH",
  full_name: "Helmholtzschule Frankfurt am Main",
  website_url: "https://www.helmholtzschule.de",
  description: "Eine Schule.",
  address: { strasse: "Habsburgerallee", hausnummer: "57", plz: "60385", stadtteil: "Ostend", stadt: "Frankfurt am Main" },
  membership: { gruppe: "A", austritt: null },
};

const draftFrom = (overrides: Partial<FLTeamDraftFields>): FLTeamDraftFields => ({ ...stored, ...overrides });

describe("deriveTeamDraftStatus", () => {
  it("reports a clean draft as not dirty, with every field present", () => {
    const status = deriveTeamDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    assert.equal(status.isDirty, false);
    assert.equal(status.changed.length, 0);
    // Every club field plus the two membership rows.
    assert.equal(status.fields.length, 12);
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
      draft: draftFrom({ membership: { gruppe: "A", austritt: { type: "rueckzug", grund: "Schule aufgelöst", datum: "2026-03-14" } } }),
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
      stored: { ...stored, membership: { gruppe: "A", austritt: { type: "disqualifikation", ...record } } },
      draft: draftFrom({ membership: { gruppe: "A", austritt: { type: "rueckzug", ...record } } }),
      fieldErrors: {},
    });

    assert.equal(status.byPath.get("austritt")?.isChanged, true);
  });

  it("drops both membership rows while the club is not in the selected season", () => {
    const noMembership = draftFrom({ membership: null });
    const status = deriveTeamDraftStatus({ stored: noMembership, draft: noMembership, fieldErrors: {} });

    assert.equal(status.fields.length, 10);
    assert.equal(status.byPath.has("gruppe"), false);
    assert.equal(status.byPath.has("austritt"), false);
  });

  it("finds an austritt error under any of the record's four paths", () => {
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ membership: { gruppe: "A", austritt: { type: "disqualifikation", grund: "", datum: "2026-03-14" } } }),
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
      draft: draftFrom({ membership: { gruppe: "A", austritt: { type: null, grund: "Nicht angetreten", datum: "2026-03-14" } } }),
      fieldErrors: { "austritt.type": "Bitte wähle, wie das Team ausgeschieden ist." },
    });

    const row = status.byPath.get("austritt");
    assert.equal(row?.error, "Bitte wähle, wie das Team ausgeschieden ist.");
    assert.match(row?.draftText ?? "", /^Art offen: /);
  });
});
