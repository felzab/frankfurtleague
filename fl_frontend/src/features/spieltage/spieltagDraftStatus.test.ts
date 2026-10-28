import { assert, describe, expect, it } from "vitest";

import { deriveSpieltagDraftStatus } from "./spieltagDraftStatus";

import type { FLSpieltagDraftFields } from "./spieltagDraftStatus";

const stored: FLSpieltagDraftFields = {
  beginn: "2026-03-14",
  ende: "2026-03-15",
};

// One row per descriptor: the path it must report, and a draft differing in that field alone.
const oneFieldChanged: readonly (readonly [string, FLSpieltagDraftFields])[] = [
  ["beginn", { ...stored, beginn: "2026-03-21" }],
  ["ende", { ...stored, ende: "2026-03-22" }],
];

describe("deriveSpieltagDraftStatus", () => {
  it("carries a row for each end of the span", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored }, fieldErrors: {}, isSingleDay: false });

    // The span is the whole editable record; the matchday's name has no row because it has no field.
    expect(status.fields.length).toBe(2);
  });

  it("reports each field under its own descriptor path, so a mistyped path cannot pass unnoticed", () => {
    for (const [path, draft] of oneFieldChanged) {
      const status = deriveSpieltagDraftStatus({ stored, draft, fieldErrors: {}, isSingleDay: false });

      expect(
        status.changed.map((field) => field.path),
        `changing ${path} should report that path and no other`,
      ).toStrictEqual([path]);
    }
  });

  it("gives every draft field a row, so a field added to the type cannot arrive without one", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored }, fieldErrors: {}, isSingleDay: false });
    const covered = new Set(status.fields.map((field) => field.path.split(".")[0]));

    expect([...covered].sort()).toStrictEqual(Object.keys(stored).sort());
  });

  it("reads a date as the German day it names rather than as the stored string", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored, beginn: "2026-03-21" }, fieldErrors: {}, isSingleDay: false });

    const row = status.byPath.get("beginn");
    assert(row !== undefined, "the status names no row for the start");
    expect(row.storedText).toBe("14.03.2026");
    expect(row.draftText).toBe("21.03.2026");
  });

  // The state a generated matchday starts in, which reaches the draft as the empty string.
  it("reads an undated matchday as holding nothing, so dating one reads as an addition", () => {
    const status = deriveSpieltagDraftStatus({ stored: { beginn: "", ende: "" }, draft: stored, fieldErrors: {}, isSingleDay: false });

    const row = status.byPath.get("beginn");
    // `readDatum`'s empty guard on the STORED side: without it a generated matchday reads as the
    // date placeholder, and dating one would render as an edit rather than as an addition.
    assert.ok(row);
    expect(row.storedText).toBe(null);
  });

  it("reads an emptied date as a removal, which is what the change list should show", () => {
    const status = deriveSpieltagDraftStatus({ stored, draft: { ...stored, ende: "" }, fieldErrors: {}, isSingleDay: false });

    const row = status.byPath.get("ende");
    // `readDatum`'s empty guard is what renders this as a removal rather than as the date placeholder.
    assert.ok(row);
    expect(row.draftText).toBe(null);
  });

  it("carries the span message on ende, where the payload schema puts it", () => {
    const status = deriveSpieltagDraftStatus({
      stored,
      draft: { ...stored, ende: "2026-03-01" },
      fieldErrors: { ende: "Das Ende darf nicht vor dem Beginn liegen." },
      isSingleDay: false,
    });

    expect(status.byPath.get("ende")?.error).toBe("Das Ende darf nicht vor dem Beginn liegen.");
    expect(status.invalid.map((field) => field.path)).toStrictEqual(["ende"]);
  });
});

/** A final, whose one picker writes the picked day into both ends of the span before anything reads the draft. */
const dayStored: FLSpieltagDraftFields = { beginn: "2026-06-20", ende: "2026-06-20" };
const dayPicked: FLSpieltagDraftFields = { beginn: "2026-06-27", ende: "2026-06-27" };

describe("deriveSpieltagDraftStatus where one picker dates the matchday", () => {
  it("names its row after the picker rather than after either end of a span", () => {
    const status = deriveSpieltagDraftStatus({ stored: dayStored, draft: dayPicked, fieldErrors: {}, isSingleDay: true });

    expect(status.fields.map((field) => [field.path, field.label, field.group])).toStrictEqual([["beginn", "Datum", "Zeitraum"]]);
    // `useFieldStatus("ende")` answering undefined is the point: no picker renders that path here.
    expect(status.byPath.get("ende")).toBe(undefined);
  });

  it("counts one change where the span arrangement counts the same day twice", () => {
    const asSpan = deriveSpieltagDraftStatus({ stored: dayStored, draft: dayPicked, fieldErrors: {}, isSingleDay: false });

    // What the reader met before the parameter existed: two rows over one picked day, and a discard
    // dialog offering to throw away 2 Änderungen.
    expect(asSpan.changed.map((field) => `${field.label}: ${String(field.draftText)}`)).toStrictEqual([
      "Beginn: 27.06.2026",
      "Ende: 27.06.2026",
    ]);
    expect(asSpan.changed.length).toBe(2);

    const status = deriveSpieltagDraftStatus({ stored: dayStored, draft: dayPicked, fieldErrors: {}, isSingleDay: true });

    expect(status.isDirty).toBe(true);
    expect(status.changed.map((field) => `${field.label}: ${String(field.draftText)}`)).toStrictEqual(["Datum: 27.06.2026"]);
    // `ConfirmDiscardModal`'s `changeCount`, which words itself for one and for many.
    expect(status.changed.length).toBe(1);
    expect(status.changed[0]?.storedText).toBe("20.06.2026");
  });

  it("leaves a matchday dated at both ends the two rows it renders", () => {
    const status = deriveSpieltagDraftStatus({
      stored,
      draft: { beginn: "2026-03-21", ende: "2026-03-22" },
      fieldErrors: {},
      isSingleDay: false,
    });

    expect(status.changed.map((field) => field.label)).toStrictEqual(["Beginn", "Ende"]);
  });

  it("carries a message the schema names on ende to the row the reader can see", () => {
    const status = deriveSpieltagDraftStatus({
      stored: dayStored,
      draft: dayPicked,
      fieldErrors: { ende: "Das Ende darf nicht vor dem Beginn liegen." },
      isSingleDay: true,
    });

    // Without `errorPaths` this message reaches no row at all: `FormActionBar` counts no field to
    // check, and `useServerFieldErrors` sends it to the outside-this-form toast instead.
    expect(status.byPath.get("beginn")?.error).toBe("Das Ende darf nicht vor dem Beginn liegen.");
    expect(status.invalid.map((field) => field.path)).toStrictEqual(["beginn"]);
  });

  it("shows the containment refusal, which the action names on beginn, on that same row", () => {
    const status = deriveSpieltagDraftStatus({
      stored: dayStored,
      draft: dayPicked,
      fieldErrors: { beginn: "Dieser Zeitraum liegt außerhalb des Zeitraums der Saison." },
      isSingleDay: true,
    });

    // That `beginn` is the first `errorPaths` entry is this table's, so only a case over this table
    // can pin which row a message on that path reaches.
    expect(status.byPath.get("beginn")?.error).toBe("Dieser Zeitraum liegt außerhalb des Zeitraums der Saison.");
  });
});
