import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * The noun's own article is not one — `den Schiedsrichter` names the record. The same sentence in the
 * venue dialog keeps its `Er`, which agrees with a place and must not be recast.
 */
const MASKULIN = /\bdiesen schiedsrichter\b|\bsein(?:e|em|en|er|es)?\b|\b(?:er|ihn|ihm)\b/i;

describe("the retirement dialog's second step", () => {
  /* Read from source: the sentence is a prop the modal renders on its armed step alone, and arming it
     takes a press this runner has no DOM to make. */
  const MODAL = readFileSync(path.resolve(import.meta.dirname, "components", "modals", "AdminDeleteSchiedsrichterModal.tsx"), "utf8");

  it("names the referee neutrally in the consequence it escalates to", () => {
    const satz = /consequence="([^"]*)"/.exec(MODAL)?.[1];

    assert.ok(satz !== undefined, "the dialog states no consequence this case can read");
    assert.match(satz, /Schon eingetragene Spiele behalten/, "the consequence stopped naming what survives");
    assert.doesNotMatch(satz, MASKULIN, "the consequence names the referee with a masculine word");
  });
});
