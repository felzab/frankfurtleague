import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveSpieltagDraftStatus } from "./spieltagDraftStatus";

import type { FLSpieltagDraftFields } from "./spieltagDraftStatus";

const stored: FLSpieltagDraftFields = {
  beginn: "2026-03-14",
  ende: "2026-03-15",
  saison_phase: "gruppenphase",
  position: 2,
};

// One row per descriptor: the path it must report, and a draft differing in that field alone.
const oneFieldChanged: readonly (readonly [string, FLSpieltagDraftFields])[] = [
  ["saison_phase", { ...stored, saison_phase: "viertelfinale" }],
  ["position", { ...stored, position: 3 }],
  ["beginn", { ...stored, beginn: "2026-03-21" }],
  ["ende", { ...stored, ende: "2026-03-22" }],
];

describe("deriveSpieltagDraftStatus", () => {
  it("reports a clean draft as not dirty, with every field present", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });

    assert.equal(status.isDirty, false);
    assert.equal(status.changed.length, 0);
    // The name is composed from the two fields above and is not itself a row.
    assert.equal(status.fields.length, 4);
  });

  it("reports each field under its own descriptor path, so a mistyped path cannot pass unnoticed", () => {
    for (const [path, draft] of oneFieldChanged) {
      const status = deriveSpieltagDraftStatus({ stored, draft, fieldErrors: {} });

      assert.deepEqual(
        status.changed.map((field) => field.path),
        [path],
        `changing ${path} should report that path and no other`,
      );
    }
  });

  it("gives every draft field a row, so a field added to the type cannot arrive without one", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored }, fieldErrors: {} });
    const covered = new Set(status.fields.map((field) => field.path.split(".")[0]));

    assert.deepEqual([...covered].sort(), Object.keys(stored).sort());
  });

  it("reads the phase as its German label rather than as the stored key", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored, saison_phase: "halbfinale" }, fieldErrors: {} });

    const row = status.byPath.get("saison_phase");
    assert.equal(row?.storedText, "Gruppenphase");
    assert.equal(row.draftText, "Halbfinale");
  });

  it("reads an untouched phase picker as a removal rather than as a label", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored, saison_phase: null }, fieldErrors: {} });

    const row = status.byPath.get("saison_phase");
    assert.ok(row?.isChanged);
    assert.equal(row.draftText, null);
  });

  it("reads an emptied date as a removal, which is what the change list should show", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored, ende: "" }, fieldErrors: {} });

    const row = status.byPath.get("ende");
    assert.ok(row?.isChanged);
    assert.equal(row.draftText, null);
  });

  it("carries the span message on ende, where the payload schema puts it", () => {
    const status = deriveSpieltagDraftStatus({
      stored,
      draft: { ...stored, ende: "2026-03-01" },
      fieldErrors: { ende: "Das Ende darf nicht vor dem Beginn liegen." },
    });

    assert.equal(status.byPath.get("ende")?.error, "Das Ende darf nicht vor dem Beginn liegen.");
    assert.deepEqual(
      status.invalid.map((field) => field.path),
      ["ende"],
    );
  });
});
