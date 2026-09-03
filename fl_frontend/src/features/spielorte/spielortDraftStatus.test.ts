import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveSpielortDraftStatus } from "./spielortDraftStatus";

import type { FLSpielortDraftFields } from "./spielortDraftStatus";

const stored: FLSpielortDraftFields = {
  name: "Sporthalle Ostend",
  address: {
    strasse: "Hanauer Landstraße",
    hausnummer: "12a",
    plz: "60314",
    stadtteil: "Ostend",
    stadt: "Frankfurt am Main",
  },
  default_mietpreis: 120,
};

// One row per descriptor: the path it must report, and a draft differing in that field alone.
const oneFieldChanged: readonly (readonly [string, FLSpielortDraftFields])[] = [
  ["name", { ...stored, name: "Sporthalle Bornheim" }],
  ["address.strasse", { ...stored, address: { ...stored.address, strasse: "Berger Straße" } }],
  ["address.hausnummer", { ...stored, address: { ...stored.address, hausnummer: "44" } }],
  ["address.plz", { ...stored, address: { ...stored.address, plz: "60316" } }],
  ["address.stadt", { ...stored, address: { ...stored.address, stadt: "Offenbach" } }],
  ["address.stadtteil", { ...stored, address: { ...stored.address, stadtteil: "Bornheim" } }],
  ["default_mietpreis", { ...stored, default_mietpreis: 150 }],
];

describe("deriveSpielortDraftStatus", () => {
  it("carries a row for every venue field", () => {
    const status = deriveSpielortDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });

    // `maps_link` is deliberately absent: the backend derives it and no payload carries it.
    assert.equal(status.fields.length, 7);
  });

  it("reports each field under its own descriptor path, so a mistyped path cannot pass unnoticed", () => {
    for (const [path, draft] of oneFieldChanged) {
      const status = deriveSpielortDraftStatus({ stored, draft, fieldErrors: {} });

      assert.deepEqual(
        status.changed.map((field) => field.path),
        [path],
        `changing ${path} should report that path and no other`,
      );
    }
  });

  it("gives every draft field a row, so a field added to the type cannot arrive without one", () => {
    const status = deriveSpielortDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });
    const covered = new Set(status.fields.map((field) => field.path.split(".")[0]));

    assert.deepEqual([...covered].sort(), Object.keys(stored).sort());
  });

  it("never offers a row for maps_link, which no payload carries", () => {
    const status = deriveSpielortDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });

    assert.equal(status.byPath.get("maps_link"), undefined);
  });

  it("reads an emptied optional part of the address as a removal", () => {
    const draft = { ...stored, address: { ...stored.address, stadtteil: "" } };
    const status = deriveSpielortDraftStatus({ stored, draft, fieldErrors: {} });

    const row = status.byPath.get("address.stadtteil");
    // `draftText: null` is what makes the change list render this as a removal. It comes from this
    // table's own `read`, so only a case over this table can pin it.
    assert.ok(row);
    assert.equal(row.draftText, null);
    assert.equal(row.storedText, "Ostend");
  });

  it("keeps a whitespace-only edit visible, because nothing trims before the save", () => {
    const status = deriveSpielortDraftStatus({ stored, draft: { ...stored, name: "Sporthalle Ostend " }, fieldErrors: {} });

    // The trailing space survives because this table's `read` is `emptyAsNull`, which trims nothing.
    assert.equal(status.byPath.get("name")?.draftText, "Sporthalle Ostend ");
  });

  it("carries a field error onto its own row", () => {
    const status = deriveSpielortDraftStatus({
      stored,
      draft: { ...stored, address: { ...stored.address, plz: "603" } },
      fieldErrors: { "address.plz": "Die PLZ muss genau 5 Ziffern haben." },
    });

    // The descriptor's default `errorPaths`, which is this table's: widen it and the message
    // answers on a path no input carries.
    assert.equal(status.byPath.get("address.plz")?.error, "Die PLZ muss genau 5 Ziffern haben.");
  });
});
