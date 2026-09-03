import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveTeamDraftStatus } from "./teamDraftStatus";

import type { FLTeamDraftFields } from "./teamDraftStatus";

/** One junction row, so a case names only the part it is about. */
const membership = (overrides: Partial<NonNullable<FLTeamDraftFields["membership"]>> = {}): FLTeamDraftFields["membership"] => ({
  gruppe: "A",
  austritt: null,
  trikot_farbe: null,
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
  it("carries a row for every club field and every junction row", () => {
    const status = deriveTeamDraftStatus({ stored, draft: draftFrom({}), fieldErrors: {} });

    // Every club field plus every junction row. The season's three contact seats are not among them:
    // they are `fl_frontend/src/features/kontakte/kontakteDraftStatus.ts`'s, and their own page's.
    assert.equal(status.fields.length, 14);
  });

  it("reports a renamed club as one change carrying both texts", () => {
    const status = deriveTeamDraftStatus({ stored, draft: draftFrom({ name: "Helmholtz II" }), fieldErrors: {} });

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
    // `draftText: null` is what makes the change list render this as a removal. It comes from this
    // table's own `read`, so only a case over this table can pin it.
    assert.ok(row);
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
});
