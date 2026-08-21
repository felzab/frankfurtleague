import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Source text rather than a render: the repository has no DOM runner, and the claim below is about
 * the ORDER of two statements inside a press handler, which no exported value carries.
 */
function panelSource(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, file), "utf8");
}

const PANELS = [
  { name: "FormSpielplanSection", source: panelSource("FormSpielplanSection.tsx"), handler: "handleGenerate", guard: "onBeforeGenerate" },
  { name: "FormRolloverSection", source: panelSource("FormRolloverSection.tsx"), handler: "handleActivate", guard: "onBeforeActivate" },
];

describe("the two one-way panels", () => {
  /* Asserted over the pair, because the pair is what went wrong: both were given the arming-press
     guard in one edit and only one was later moved to guard both presses. */
  it("runs the draft guard before arming and again before writing", () => {
    for (const panel of PANELS) {
      const body = panel.source.split(`const ${panel.handler} = () => {`)[1] ?? "";
      const guard = body.indexOf(`${panel.guard}()`);
      const arming = body.indexOf("if (!isConfirming)");

      assert.ok(guard !== -1, `${panel.name}: no ${panel.guard}() call in ${panel.handler}`);
      assert.ok(arming !== -1, `${panel.name}: no arming branch in ${panel.handler}`);
      // Ahead of the arming branch is the whole of it: a guard behind it runs on the first press only,
      // and the fields stay live until the second one.
      assert.ok(guard < arming, `${panel.name}: a draft typed after arming is discarded by the write`);
    }
  });

  /* A refused guard has to leave the control unarmed as well as unpressed, or the alert stays open
     saying a write is one press away that the next press will refuse again. */
  it("disarms the control when the guard refuses", () => {
    for (const panel of PANELS) {
      const body = panel.source.split(`const ${panel.handler} = () => {`)[1] ?? "";
      const refusal = body.split(`if (!${panel.guard}())`)[1] ?? "";

      assert.match(refusal.split("if (!isConfirming)")[0] ?? "", /setIsConfirming\(false\)/);
    }
  });
});
