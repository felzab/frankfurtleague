import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { classListsIn } from "@/shared/testing/classTokens.ts";

import { BRAND_ICON_BUTTON, BRAND_TILE, SHORTHAND_CHIP } from "./brandTile.ts";

// Three levels up: this file sits at `src/shared/components/ui`, and a sweep rooted inside `shared`
// reports a clean tree while a feature slice draws its own brand square.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** The module holding the three spellings, which the sweep for a copy has to stand outside. */
const RECIPE = path.join(SRC, "shared", "components", "ui", "brandTile.ts");

/**
 * What identifies each box: the fill, the box size and the radius.
 *
 * Never the fill alone — a toast's action button wears `bg-brand-solid` too — and matched as whole
 * tokens, so `bg-brand-solid-hover` never stands in for it.
 */
const GRADES = {
  BRAND_TILE: ["bg-brand-solid", "size-10", "rounded-xl"],
  BRAND_ICON_BUTTON: ["bg-brand-solid", "size-9", "rounded-xl"],
  // Width-free, that being the caller's: what identifies the chip is its fill, its radius and its weight.
  SHORTHAND_CHIP: ["bg-brand-solid", "rounded-md", "font-extrabold"],
};

const isProduction = (name: string): boolean => (name.endsWith(".ts") || name.endsWith(".tsx")) && !isTestFile(name);

/**
 * Parsed rather than matched as text: each grade is named in prose wherever the choice of
 * `bg-brand-solid` is argued, and a reader counting raw occurrences grades that comment as a class list.
 */
function spellsTheBox(file: string, text: string, grade: readonly string[]): boolean {
  return classListsIn(file, text).some((list) => grade.every((token) => list.includes(token)));
}

/** The box as a copy would carry it, three shapes that wear brand without being it, and a grade named in prose. */
const SAMPLE = {
  inAClassList: 'const c = <div className="bg-brand-solid flex size-10 rounded-xl shadow-sm" />;',
  acrossATemplateHole: "const c = <div className={`bg-brand-solid size-10 ${extra} rounded-xl`} />;",
  theSeasonChip: 'const c = <span className="bg-brand-solid h-7 w-14 rounded-md" />;',
  theToastAction: 'const c = <button className="bg-brand-solid h-8 rounded-lg px-3.5" />;',
  theHoverFill: 'const c = <div className="bg-brand-solid-hover size-10 rounded-xl" />;',
  namedInAComment: "// `bg-brand-solid` at `size-10`, in a `rounded-xl` box.\nconst c = SOMETHING;",
};

describe("the brand box every surface draws", () => {
  /* The tree is uniform, so a reader stopping at the first thing it finds passes over the violation
     this sweep exists for (`docs/frontend/spec.md :: 1.9 The test suite`). */
  it("reads the box out of a class list and a template, and grades neither a brand neighbour nor a comment", () => {
    const reads = (source: string): boolean => spellsTheBox("sample.tsx", source, GRADES.BRAND_TILE);

    assert.ok(reads(SAMPLE.inAClassList), "the box in a class list reads as absent");
    assert.ok(reads(SAMPLE.acrossATemplateHole), "the box parted by a template hole reads as absent");
    assert.ok(!reads(SAMPLE.theSeasonChip), "the season id chip reads as this box");
    assert.ok(!reads(SAMPLE.theToastAction), "the toast's action button reads as this box");
    assert.ok(!reads(SAMPLE.theHoverFill), "the hover fill stands in for the fill");
    assert.ok(!reads(SAMPLE.namedInAComment), "the grade named in a comment reads as a class list");
  });

  it("composes each box out of its own grade", () => {
    for (const [name, spelled] of [
      ["BRAND_TILE", BRAND_TILE],
      ["BRAND_ICON_BUTTON", BRAND_ICON_BUTTON],
      ["SHORTHAND_CHIP", SHORTHAND_CHIP],
    ] as const) {
      const tokens = spelled.split(" ");

      for (const token of GRADES[name]) assert.ok(tokens.includes(token), `${name} composes to ${spelled}, which drops ${token}`);
    }
  });

  /* Two copies of a box drift one token at a time, and the copy that lost `shrink-0` collapses in
     whichever flex row its author did not have open. */
  it("is the only place each box is spelled", () => {
    const production = filesUnder(SRC, isProduction, 400).filter((file) => file !== RECIPE);

    for (const [name, grade] of Object.entries(GRADES)) {
      // An exemption outliving the copy it was written for spares whatever is written in that file next.
      assert.ok(spellsTheBox(RECIPE, readFileSync(RECIPE, "utf8"), grade), `${rel(RECIPE)}: spells no ${name}`);

      const spellings = production.filter((file) => spellsTheBox(file, readFileSync(file, "utf8"), grade)).map(rel);

      assert.deepEqual(spellings, [], `these spell ${name} inline instead of taking it:\n  ${spellings.join("\n  ")}`);
    }
  });
});
