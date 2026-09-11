import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { BRAND_INK } from "./brandInk.ts";

// Three levels: this file sits at `src/shared/components/ui`, and the sweep below has to walk all of
// `src` or it reports a clean tree while a feature spells the grade itself.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * Every shipped module under `src`, both suffixes.
 *
 * A recipe is a `.ts` file, which is the one kind a walk for components alone never reaches — and
 * the kind a second copy of this grade would be written in.
 */
const componentsUnder = (dir: string): string[] => filesUnder(dir, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 500);

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** The grade as a copy would carry it, the dark arm included through its own prefix. */
const SPELLS_THE_GRADE = /hover:text-brand-solid/;

/** The two recipes the grade belongs to, which the sweep for a third has to stand outside. */
const RECIPES = ["brandInk.ts", "textLink.ts"].map((name) => path.join(SRC, "shared", "components", "ui", name));

describe("the grade a brand-coloured control outside prose wears", () => {
  /* `brand-solid` is one value in both themes, so a grade losing its dark arm compiles, lints and
     renders — and sinks the hovered control into the card it sits on (`docs/frontend/spec.md :: I161`). */
  it("hovers to a value each theme declares for itself", () => {
    assert.match(BRAND_INK, /(^|\s)hover:text-brand-solid(\s|$)/);
    assert.match(BRAND_INK, /(^|\s)dark:hover:text-brand-solid-accent(\s|$)/);
  });

  /* The underline is what parts this from `textLink`, whose base carries one for every caller
     (`docs/frontend/spec.md :: I43`). With one here the two recipes name the same control. */
  it("leaves the underline to the link recipe", () => {
    assert.doesNotMatch(BRAND_INK, /underline/);
  });

  /* Two copies of a three-class grade drift one class at a time, and the copy missing the dark arm
     renders fine in whichever theme its author had open. */
  it("is the only place the grade is spelled outside the link recipe", () => {
    // An exemption outliving the copy it was written for spares whatever is written in that file next.
    for (const recipe of RECIPES) assert.match(readFileSync(recipe, "utf8"), SPELLS_THE_GRADE, `${rel(recipe)}: spells no brand grade`);

    const spellings = componentsUnder(SRC)
      .filter((file) => !RECIPES.includes(file) && SPELLS_THE_GRADE.test(readFileSync(file, "utf8")))
      .map(rel);

    assert.deepEqual(spellings, [], `these spell the brand grade inline instead of taking \`BRAND_INK\`:\n  ${spellings.join("\n  ")}`);
  });
});
