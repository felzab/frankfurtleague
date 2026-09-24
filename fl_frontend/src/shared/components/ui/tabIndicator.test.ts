import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { TAB_INDICATOR_CLASSES, TAB_TRACK_CLASSES } from "./formFieldStyles.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..");
const SCHEME_CHECK = readFileSync(path.join(REPO_ROOT, "scripts", "checks", "docs_gate", "scheme.py"), "utf8");

/** What a utility's colour is called in the palette, which is the name the gate measures. */
const PALETTE: Record<string, string> = { brand: "--accent-brand", muted: "--bg-muted" };

const tokensOf = (recipe: string): string[] => recipe.split(" ");

/** The colour a `<utility>-<name>` class paints, as the palette spells it. */
function paletteToken(recipe: string, utility: string): string {
  const worn = tokensOf(recipe).find((token) => token.startsWith(`${utility}-`));
  if (worn === undefined) throw new Error(`the recipe wears no \`${utility}-\` class: ${recipe}`);

  const named = PALETTE[worn.slice(utility.length + 1)];
  if (named === undefined) throw new Error(`\`${worn}\` names a colour this file cannot place in the palette`);

  return named;
}

describe("the mark on the selected tab", () => {
  /* `bg-brand-solid` is one fill in both themes and the recessed track under it is not, so the fill
     alone says nothing about which tab is selected wherever the two measure alike. */
  it("rings the indicator rather than resting on its fill alone", () => {
    assert.ok(tokensOf(TAB_INDICATOR_CLASSES).includes("ring-1"), `the indicator is ${TAB_INDICATOR_CLASSES}, which draws no ring`);
    assert.equal(paletteToken(TAB_INDICATOR_CLASSES, "ring"), "--accent-brand");
  });

  /* The gate measures the palette and knows nothing of the recipes, so a ring it has no pair for is
     one no theme change can be caught against — which is how this pair came to measure 1.24:1. */
  it("is measured against its own track by the scheme gate", () => {
    const ring = paletteToken(TAB_INDICATOR_CLASSES, "ring");
    const track = paletteToken(TAB_TRACK_CLASSES, "bg");

    // Opening its line, so a pair commented out, which measures nothing, reads as absent.
    assert.match(
      SCHEME_CHECK,
      new RegExp(String.raw`^[ \t]*Pair\([^)]*Layer\("${ring}"\), Layer\("${track}"\), 3\.0\)`, "m"),
      `scheme.py records no 3:1 pair for \`${ring}\` on \`${track}\`, so the ring is unmeasured`,
    );
  });
});
