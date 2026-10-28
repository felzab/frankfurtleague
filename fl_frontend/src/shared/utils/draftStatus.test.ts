import { assert, describe, expect, it } from "vitest";

import { deriveDraftStatus, emptyAsNull, fieldStatus, numberAsNull } from "./draftStatus.ts";

import type { FLFieldDescriptor } from "./draftStatus.ts";
import type { FieldErrors } from "./validation.ts";

/** No slice's shape: the fold reads a source only through a descriptor's `read`, so a synthetic one reaches every branch. */
type Source = {
  name: string;
  note: string | null;
  count: number | null;
  slot: { label: string } | null;
};

type Group = "Main" | "Aside";

const DESCRIPTORS: readonly FLFieldDescriptor<Source, Group>[] = [
  { path: "name", label: "Name", group: "Main", read: (source) => emptyAsNull(source.name) },
  { path: "note", label: "Note", group: "Main", read: (source) => emptyAsNull(source.note) },
  { path: "count", label: "Count", group: "Aside", read: (source) => numberAsNull(source.count) },
  {
    path: "slot",
    label: "Slot",
    group: "Aside",
    appliesTo: (source) => source.slot !== null,
    // Neither entry is this row's own path, deliberately: adding `slot` would leave nothing telling a
    // fold that REPLACES the default `[path]` from one that widens it.
    errorPaths: ["slot.label", "slot.other"],
    read: (source) => emptyAsNull(source.slot?.label ?? null),
  },
];

const STORED: Source = { name: "Alpha", note: "Eine Notiz", count: 3, slot: { label: "Links" } };

const draftFrom = (overrides: Partial<Source>): Source => ({ ...STORED, ...overrides });

const derive = ({ stored = STORED, draft, fieldErrors = {} }: { stored?: Source; draft: Source; fieldErrors?: FieldErrors }) =>
  deriveDraftStatus({ descriptors: DESCRIPTORS, stored, draft, fieldErrors });

/**
 * Empty is `null`; everything else comes back as typed. The padded rows are the pin: a comparator that
 * trimmed calls an added space no change, and the save writes it anyway.
 * `fl_frontend/src/shared/utils/draftStatus.ts :: emptyAsNull` holds why nothing trims.
 */
const EMPTY_AS_NULL: readonly (readonly [string | null, string | null])[] = [
  [null, null],
  ["", null],
  ["   ", null],
  ["\t\n", null],
  ["Alpha", "Alpha"],
  [" Alpha", " Alpha"],
  ["Alpha ", "Alpha "],
  [" Alpha ", " Alpha "],
];

describe("emptyAsNull", () => {
  it("reads empty and whitespace alone as nothing, and hands back every other value as typed", () => {
    expect(EMPTY_AS_NULL.map(([value]) => [value, emptyAsNull(value)])).toStrictEqual(EMPTY_AS_NULL);
  });
});

/** `0` is the boundary a truthiness test loses: a season awarding no points for a draw is a real setting. */
const NUMBER_AS_NULL: readonly (readonly [number | null, string | null])[] = [
  [null, null],
  [0, "0"],
  [7, "7"],
];

describe("numberAsNull", () => {
  it("reads an emptied number as nothing and every figure as its digits", () => {
    expect(NUMBER_AS_NULL.map(([value]) => [value, numberAsNull(value)])).toStrictEqual(NUMBER_AS_NULL);
  });
});

/** One row per descriptor: the path it must report, and a draft differing in that field alone. */
const ONE_FIELD_CHANGED: readonly (readonly [string, Source])[] = [
  ["name", draftFrom({ name: "Beta" })],
  ["note", draftFrom({ note: "Eine andere Notiz" })],
  ["count", draftFrom({ count: 7 })],
  ["slot", draftFrom({ slot: { label: "Rechts" } })],
];

/** The two-message row pins the ORDER: the first `errorPaths` entry carrying a message wins, a row holding one and no more. */
const ERROR_LOOKUP: readonly (readonly [FieldErrors, string | null])[] = [
  [{}, null],
  [{ slot: "Auf dem eigenen Pfad." }, null],
  [{ "slot.other": "Auf dem zweiten Pfad." }, "Auf dem zweiten Pfad."],
  [{ "slot.label": "Auf dem ersten Pfad.", "slot.other": "Auf dem zweiten Pfad." }, "Auf dem ersten Pfad."],
  [{ nirgendwo: "Auf gar keinem Pfad." }, null],
];

describe("deriveDraftStatus", () => {
  it("reports a clean draft as not dirty, with a row per descriptor carrying its label and its group", () => {
    const status = derive({ draft: draftFrom({}) });

    expect(status.isDirty).toBe(false);
    expect(status.changed).toStrictEqual([]);
    expect(status.fields.map((field) => [field.path, field.label, field.group, field.isChanged, field.error, field.storedText])).toStrictEqual([
      ["name", "Name", "Main", false, null, "Alpha"],
      ["note", "Note", "Main", false, null, "Eine Notiz"],
      ["count", "Count", "Aside", false, null, "3"],
      ["slot", "Slot", "Aside", false, null, "Links"],
    ]);
  });

  it("reports one edited field as the only change, carrying both texts", () => {
    const status = derive({ draft: draftFrom({ name: "Beta" }) });

    expect(status.isDirty).toBe(true);
    expect(status.changed.map((field) => [field.path, field.storedText, field.draftText])).toStrictEqual([["name", "Alpha", "Beta"]]);
  });

  it("reports each field under its own descriptor path, so no row can answer for its neighbour", () => {
    expect(ONE_FIELD_CHANGED.map(([path, draft]) => [path, derive({ draft }).changed.map((field) => field.path)])).toStrictEqual(
      ONE_FIELD_CHANGED.map(([path]) => [path, [path]]),
    );
  });

  it("carries several changes in the descriptor table's order", () => {
    const status = derive({ draft: draftFrom({ count: 7, name: "Beta" }) });

    expect(status.changed.map((field) => field.path)).toStrictEqual(["name", "count"]);
  });

  it("reads an emptied field as a removal rather than as a change to the empty string", () => {
    const row = derive({ draft: draftFrom({ name: "" }) }).byPath.get("name");

    assert.ok(row?.isChanged);
    // `draftText: null` is what makes the change list render this as a removal.
    expect(row.draftText).toBe(null);
    expect(row.storedText).toBe("Alpha");
  });

  it("reads null, the empty string and whitespace alone as one and the same nothing", () => {
    const clearedToNull = derive({ stored: draftFrom({ note: "" }), draft: draftFrom({ note: null }) });
    const clearedToSpaces = derive({ stored: draftFrom({ note: null }), draft: draftFrom({ note: "   " }) });

    expect(clearedToNull.isDirty).toBe(false);
    expect(clearedToSpaces.isDirty).toBe(false);
    expect(clearedToSpaces.byPath.get("note")?.draftText).toBe(null);
  });

  it("keeps a whitespace-only edit visible, because nothing trims before the save", () => {
    const status = derive({ draft: draftFrom({ name: "Alpha " }) });

    expect(status.isDirty).toBe(true);
    expect(status.byPath.get("name")?.draftText).toBe("Alpha ");
  });

  it("drops a descriptor whose appliesTo is false, so it neither renders a row nor counts as dirty", () => {
    const status = derive({ draft: draftFrom({ slot: null }) });

    expect(status.fields.map((field) => field.path)).toStrictEqual(["name", "note", "count"]);
    // The stored slot is gone and the fold still reports nothing: a filtered descriptor leaves the
    // comparison, not merely the rendering.
    expect(status.isDirty).toBe(false);
  });

  it("asks appliesTo of the draft alone, so a row arriving mid-edit still compares against the stored read", () => {
    const status = derive({ stored: draftFrom({ slot: null }), draft: draftFrom({ slot: { label: "Rechts" } }) });

    const row = status.byPath.get("slot");
    assert.ok(row?.isChanged);
    expect(row.storedText).toBe(null);
    expect(row.draftText).toBe("Rechts");
  });

  it("carries a field error onto its own row and into invalid, leaving the row unchanged", () => {
    const status = derive({ draft: draftFrom({}), fieldErrors: { note: "Bitte fülle dieses Feld aus." } });

    expect(status.byPath.get("note")?.error).toBe("Bitte fülle dieses Feld aus.");
    expect(status.invalid.map((field) => field.path)).toStrictEqual(["note"]);
    // A message and an edit are independent verdicts: a bar counting changes has nothing to discard
    // here, and one counting errors refuses the save.
    expect(status.isDirty).toBe(false);
  });

  it("looks a row's message up under its own errorPaths, in order, and nowhere else", () => {
    expect(
      ERROR_LOOKUP.map(([fieldErrors]) => [fieldErrors, derive({ draft: draftFrom({}), fieldErrors }).byPath.get("slot")?.error ?? null]),
    ).toStrictEqual(ERROR_LOOKUP);
  });

  it("lands a message no descriptor claims on no row at all", () => {
    const status = derive({ draft: draftFrom({}), fieldErrors: { slot: "Auf dem eigenen Pfad.", nirgendwo: "Auf gar keinem Pfad." } });

    expect(status.invalid).toStrictEqual([]);
  });

  it("answers byPath for exactly the rows it reports, so no marker asks after a row that is not there", () => {
    // A draft the `slot` descriptor is filtered out of. Where every descriptor applies, the two
    // lists agree under any fold, one keying `byPath` off the unfiltered `descriptors` included.
    const status = derive({ draft: draftFrom({ slot: null }) });

    expect([...status.byPath.keys()]).toStrictEqual(status.fields.map((field) => field.path));
  });
});

describe("fieldStatus", () => {
  it("answers no row for a declared path whose descriptor does not apply to the draft", () => {
    expect(fieldStatus(derive({ draft: draftFrom({ slot: null }) }), "slot")).toBe(undefined);
  });

  /* The label and the editor's own lookup both read through here, and `undefined` would pass a misspelt
     path off as a field left unchanged. */
  it("throws for a path the table does not declare", () => {
    expect(() => fieldStatus(derive({ draft: draftFrom({}) }), "nmae")).toThrow(/nmae is no path/);
  });
});
