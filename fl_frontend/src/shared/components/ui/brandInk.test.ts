import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { BRAND_INK } from "./brandInk.ts";

// Three levels: this file sits at `src/shared/components/ui`, and the sweep below has to walk all of
// `src` or it reports a clean tree while a feature spells the grade itself.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/** Every shipped `.tsx` under `src`, which is where a control a reader meets can be spelled. */
const componentsUnder = (dir: string): string[] => filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 200);

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
    const spellings = componentsUnder(SRC)
      .filter((file) => /hover:text-brand-solid/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

    assert.deepEqual(spellings, [], `these spell the brand grade inline instead of taking \`BRAND_INK\`:\n  ${spellings.join("\n  ")}`);
  });
});
