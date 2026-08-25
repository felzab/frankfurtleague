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
  { name: "FormSpielplanSection", source: panelSource("FormSpielplanSection.tsx"), guard: "onBeforeGenerate" },
  { name: "FormRolloverSection", source: panelSource("FormRolloverSection.tsx"), guard: "onBeforeActivate" },
  { name: "FormSpielplanRuecknahmeSection", source: panelSource("FormSpielplanRuecknahmeSection.tsx"), guard: "onBeforeUndraw" },
];

describe("the season editor's one-way panels", () => {
  it("reads a panel body out of each file before asserting over it", () => {
    // A slice that came back empty would let every case below pass over nothing, which is how three
    // refusal tests on this branch were found green while proving no such thing.
    for (const panel of PANELS) {
      assert.ok(panel.source.includes("useTwoPressConfirm"), `${panel.name}: not a two-press panel`);
    }
  });

  /* Asserted over the set, because the set is what went wrong: the panels were given the arming-press
     guard in one edit and only one was later moved to guard both presses. The ORDER those guards run
     in is the hook's own and is pinned once at `shared/hooks/useTwoPressConfirm.test.ts`; what stays
     here is that each panel actually hands its guard over rather than checking it itself. */
  it("hands its draft guard to the shared hook rather than arming on its own", () => {
    for (const panel of PANELS) {
      assert.match(panel.source, new RegExp(`useTwoPressConfirm\\(${panel.guard}\\)`), `${panel.name}: guard not passed to the hook`);
      assert.doesNotMatch(panel.source, /setIsConfirming/, `${panel.name}: arms itself instead of asking the hook`);
    }
  });
});
