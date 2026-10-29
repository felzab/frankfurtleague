import { assert, describe, expect, it } from "vitest";

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
    expect(status.fields.length).toBe(14);
  });

  it("reports a renamed club as one change carrying both texts", () => {
    const status = deriveTeamDraftStatus({ stored, draft: draftFrom({ name: "Helmholtz II" }), fieldErrors: {} });

    expect(status.changed.map((field) => [field.path, field.storedText, field.draftText])).toStrictEqual([
      ["name", "Helmholtz", "Helmholtz II"],
    ]);
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
    expect(row.draftText).toBe(null);
    expect(row.storedText).toBe("Ostend");
  });

  it("formats an entered austritt with its route, reason and formatted date", () => {
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ membership: membership({ austritt: { type: "rueckzug", grund: "Schule aufgelöst", datum: "2026-03-14" } }) }),
      fieldErrors: {},
    });

    const row = status.byPath.get("austritt");
    assert.ok(row?.isChanged);
    expect(row.storedText).toBe(null);
    expect(row.draftText ?? "").toMatch(/^Rückzug: Schule aufgelöst \(ab 14\./);
  });

  it("sees a route swapped on an otherwise identical record as a change", () => {
    const record = { grund: "Nicht angetreten", datum: "2026-03-14" } as const;
    const status = deriveTeamDraftStatus({
      stored: { ...stored, membership: membership({ austritt: { type: "disqualifikation", ...record } }) },
      draft: draftFrom({ membership: membership({ austritt: { type: "rueckzug", ...record } }) }),
      fieldErrors: {},
    });

    expect(status.byPath.get("austritt")?.isChanged).toBe(true);
  });

  it("drops every membership row while the club is not in the selected season", () => {
    const noMembership = draftFrom({ membership: null });
    const status = deriveTeamDraftStatus({ stored: noMembership, draft: noMembership, fieldErrors: {} });

    expect(status.fields.length).toBe(11);
    expect(status.byPath.has("gruppe")).toBe(false);
    expect(status.byPath.has("austritt")).toBe(false);
    expect(status.byPath.has("trikot_farbe")).toBe(false);
  });

  it("finds an austritt error under any of the record's four paths", () => {
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ membership: membership({ austritt: { type: "disqualifikation", grund: "", datum: "2026-03-14" } }) }),
      fieldErrors: { "austritt.grund": "Bitte gib einen Grund an." },
    });

    const row = status.byPath.get("austritt");
    expect(row?.error).toBe("Bitte gib einen Grund an.");
    expect(status.invalid.map((field) => field.path)).toStrictEqual(["austritt"]);
  });

  it("finds the unpicked route under its own path, and renders the record as still open", () => {
    const status = deriveTeamDraftStatus({
      stored,
      draft: draftFrom({ membership: membership({ austritt: { type: null, grund: "Nicht angetreten", datum: "2026-03-14" } }) }),
      fieldErrors: { "austritt.type": "Bitte wähle, wie das Team ausgeschieden ist." },
    });

    const row = status.byPath.get("austritt");
    expect(row?.error).toBe("Bitte wähle, wie das Team ausgeschieden ist.");
    expect(row?.draftText ?? "").toMatch(/^Art nicht hinterlegt: /);
  });
});
