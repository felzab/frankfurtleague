import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Whitespace-collapsed: the actions are JSX, so the formatter picks their line breaks. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "RowActions.tsx"), "utf8").replace(/\s+/g, " ");

/** One declaration's source, up to the declaration named after it. */
function sliceBetween(from: string, to: string): string {
  const start = SOURCE.indexOf(from);
  const end = SOURCE.indexOf(to, start + from.length);

  return start === -1 || end === -1 ? "" : SOURCE.slice(start, end);
}

const RESTORE = sliceBetween("export function RowActionRestore", "export function RowActionDelete");

const BUTTON_SHAPE = sliceBetween("const ACTION_BUTTON_SHAPE", "const ACTION_BUTTON_CLASS");

describe("RowActionRestore's refusal", () => {
  /* A restore the endpoint would refuse is offered from a row exactly as it was from a form, so the
     restore takes the delete's mechanism rather than a second one built beside it. */
  it("takes a reason that is itself the gate", () => {
    assert.match(RESTORE, /isDisabled=\{disabledReason != null\}/, "the restore reads a boolean rather than the reason");
    assert.ok(RESTORE.includes("<DisabledHint reason={disabledReason}>"), "the refusal is not said on the control");
  });

  /* Four call sites pass none, and a required prop would move a compile error onto every list whose
     restore the endpoint never refuses. */
  it("leaves the reason optional", () => {
    assert.match(RESTORE, /disabledReason\?: string \| null;/, "the reason became required");
  });

  /* The one silent half: a disabled button swallows the pointer event and no ancestor sees it, so
     `DisabledHint`'s wrapper never opens and the row reports nothing at all. */
  it("makes the disabled button transparent to the pointer", () => {
    assert.ok(BUTTON_SHAPE.includes("disabled:pointer-events-none"), "the shape the restore wears no longer clears pointer events");
    assert.ok(RESTORE.includes("className={ACTION_BUTTON_CLASS}"), "the restore wears a class built from something else");
  });
});
