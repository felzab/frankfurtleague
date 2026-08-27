import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `undrawSpielplan.test.ts`'s idiom and for its reason. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "FormSonderereignisSection.tsx"), "utf8");

/** The select alone, which stands only while the switch is on. */
const SELECT = (SOURCE.split("<Select\n")[1] ?? "").split("</Select>")[0] ?? "";

describe("the Sonderereignis panel's pick", () => {
  /* First, because a boundary string that stopped matching leaves the slice empty and every
     assertion over it would then fail for something that is not the defect. */
  it("cuts the select out of the file before reading it", () => {
    assert.ok(SELECT.includes('name="sonderereignis"'), "the select is outside its slice");
    assert.ok(!SELECT.includes("<section"), "the slice runs on into the markup");
  });

  /* An asserted event nobody picked saves as `null`, which the write path accepts and the change
     list cannot report. Only the control can refuse it, and only on submit, through the browser. */
  it("refuses an empty pick at the control, which stands on the switch alone", () => {
    assert.match(SELECT, /\bisRequired\b/);
    assert.ok(SOURCE.includes("{hasSonderereignis && ("), "the select no longer stands on the switch alone");
  });

  /* A tint retyped at a call site is one that drifts from the panel around it, so both halves of
     the switch read the tone rather than a colour of their own. */
  it("takes the switch's tint from the panel's tone", () => {
    assert.match(SOURCE, /formPanel\(\{ tone: "danger" \}\)/);
    assert.match(SOURCE, /<Switch\.Content className=\{styles\.switchContent\(\)\}>/);
    assert.match(SOURCE, /<Switch\.Control className=\{styles\.switchControl\(\)\}>/);
  });
});
