import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { toFieldErrors } from "../../shared/utils/validation.ts";
import { buildPatchSpieltagPayloadSchema } from "./schemas.ts";

const SPAN = { start: "2026-09-01", end: "2027-06-30" };
const WITHIN = { id: "a".repeat(24), beginn: "2026-10-05", ende: "2026-10-05" };

/**
 * `toFieldErrors` itself, never a second fold beside it: two refines can land on one path, and it keeps the
 * FIRST. A local `fromEntries` keeps the last and would grade a message the form never renders.
 */
function refusals(payload: unknown, span?: { start: string; end: string }) {
  const result = buildPatchSpieltagPayloadSchema(span).safeParse(payload);

  return result.success ? {} : toFieldErrors(result.error);
}

describe("the season span a matchday is dated inside", () => {
  it("accepts a day the season covers", () => {
    assert.deepEqual(refusals(WITHIN, SPAN), {});
  });

  it("refuses a start before the season, on the field that holds it", () => {
    // The span is the schema's rule, so it is judged on the blur and named in German on the field that
    // holds the day — never on each keystroke of a year still being typed.
    assert.deepEqual(refusals({ ...WITHIN, beginn: "2026-08-31", ende: "2026-08-31" }, SPAN), {
      beginn: "Wähle einen Tag innerhalb der Saison.",
      ende: "Wähle einen Tag innerhalb der Saison.",
    });
  });

  it("refuses an end after the season without touching the start", () => {
    assert.deepEqual(refusals({ ...WITHIN, ende: "2027-07-01" }, SPAN), { ende: "Wähle einen Tag innerhalb der Saison." });
  });

  it("still refuses an end before its own start, which is the rule the span does not replace", () => {
    assert.deepEqual(refusals({ ...WITHIN, beginn: "2026-10-06", ende: "2026-10-05" }, SPAN), {
      ende: "Das Ende darf nicht vor dem Beginn liegen.",
    });
  });

  it("says nothing about a span it was not given, so a matchday with no season loaded still saves", () => {
    assert.deepEqual(refusals({ ...WITHIN, beginn: "2020-01-01", ende: "2020-01-01" }, undefined), {});
  });

  it("is built from the editor's OWN span, and not from a routine standing beside it", () => {
    // The case above makes an absent span legal, so passing `undefined` here would disable the rule while
    // every assertion in this file still passed. Only the wiring can tell the two apart.
    const editor = readFileSync(
      path.join(import.meta.dirname, "components", "forms", "AdminSpieltagEditForm", "AdminSpieltagEditForm.tsx"),
      "utf8",
    );

    assert.match(editor, /schemas: \{ spieltag: buildPatchSpieltagPayloadSchema\(saisonSpan\) \}/);
  });
});
