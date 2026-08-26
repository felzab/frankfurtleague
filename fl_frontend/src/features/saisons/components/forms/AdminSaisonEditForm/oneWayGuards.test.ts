import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Source text rather than a render: the repository has no DOM runner, and what is claimed here is
 * which argument a panel hands the shared hook, which no exported value carries.
 */
function panelSource(file: string): string {
  return readFileSync(path.resolve(import.meta.dirname, file), "utf8");
}

const PANELS = [
  { name: "FormSpielplanSection", source: panelSource("FormSpielplanSection.tsx"), guard: "onBeforeWrite" },
  { name: "FormRolloverSection", source: panelSource("FormRolloverSection.tsx"), guard: "onBeforeActivate" },
];

describe("the season editor's one-way panels", () => {
  it("reads a panel body out of each file before asserting over it", () => {
    // The floor for the case below, whose `doesNotMatch` half passes over an empty string: a source
    // that came back empty would prove nothing.
    for (const panel of PANELS) {
      assert.ok(panel.source.includes("useTwoPressConfirm"), `${panel.name}: not a two-press panel`);
    }
  });

  /* Over the set, not one panel: what this catches is one panel arming itself while its neighbours
     delegate. The order the two guards run in is the hook's own, pinned at
     `shared/hooks/useTwoPressConfirm.test.ts`. */
  it("hands its draft guard to the shared hook rather than arming on its own", () => {
    for (const panel of PANELS) {
      assert.match(panel.source, new RegExp(`useTwoPressConfirm\\(${panel.guard}\\)`), `${panel.name}: guard not passed to the hook`);
      assert.doesNotMatch(panel.source, /setIsConfirming/, `${panel.name}: arms itself instead of asking the hook`);
    }
  });
});
