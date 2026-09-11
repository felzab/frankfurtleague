import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { classTokensIn } from "@/shared/testing/classTokens.ts";

import { BRAND_INK_OUTSIDE_PROSE, textLink } from "./textLink.ts";

// Three levels: this file sits at `src/shared/components/ui`, and the sweeps below have to walk all
// of `src` or they report a clean tree while every feature spells its own.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/**
 * Every shipped module under `src`, both suffixes.
 *
 * A recipe is a `.ts` file, which is the one kind a walk for components alone never reaches — and
 * the kind a second copy of either treatment would be written in.
 */
const modulesUnder = (dir: string): string[] => filesUnder(dir, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 500);

/** The grade as a copy would carry it, the dark arm included through its own prefix. */
const SPELLS_THE_GRADE = /hover:text-brand-solid/;

/** The decoration as a copy would carry it, a `group-hover:` or `sm:` variant included. */
const SPELLS_THE_DECORATION = /hover:underline|underline-offset/;

/** The module holding both, which either sweep for a copy has to stand outside. */
const RECIPE = path.join(SRC, "shared", "components", "ui", "textLink.ts");

/** One module's class tokens, which is what either sweep reads rather than its raw text. */
const tokensOf = (file: string): string[] => classTokensIn(rel(file), readFileSync(file, "utf8"));

const classesOf = (recipe: string): Set<string> => new Set(recipe.split(" "));

describe("the one treatment a link inside text wears", () => {
  /* Colour alone is not a link to a reader who cannot see it, which is why the underline is in the
     BASE and not a variant a call site can decline. */
  it("underlines in the base, where no tone and no switch can decline it", () => {
    // `tone` alone: a second group is how the underline becomes something a call site turns off.
    assert.deepEqual(textLink.variantKeys, ["tone"], "the recipe grew a switch beside the tone");

    for (const tone of ["brand", "muted"] as const) {
      assert.match(textLink({ tone: tone }), /(^|\s)underline(\s|$)/, `the ${tone} tone leaves the underline to a hover`);
    }
  });

  /* The two tones say different things — one carries the page's own action, one ranks below a
     primary — so they may not resolve to the same colour. */
  it("keeps the quiet tone distinct from the brand one", () => {
    assert.notEqual(textLink({ tone: "brand" }), textLink({ tone: "muted" }));
    assert.match(textLink({ tone: "brand" }), /text-brand/);
    assert.match(textLink({ tone: "muted" }), /text-foreground-muted/);
  });

  /* Six hand-written spellings of one thing is what this replaced. A seventh reads as a different
     kind of control to anybody scanning the page, and nothing else in the toolchain sees it. */
  it("is the only place a link's underline and colour are spelled", () => {
    // The recipe is a `.ts` module, so a floor on its own tokens is what says the sweep below still
    // reaches the kind a walk for components never did.
    assert.ok(
      tokensOf(RECIPE).some((klasse) => SPELLS_THE_DECORATION.test(klasse)),
      `${rel(RECIPE)}: spells no link decoration`,
    );

    const spellings = modulesUnder(SRC)
      .filter((file) => file !== RECIPE && tokensOf(file).some((klasse) => SPELLS_THE_DECORATION.test(klasse)))
      .map(rel);

    assert.deepEqual(spellings, [], `these spell a link treatment inline instead of taking \`textLink\`:\n  ${spellings.join("\n  ")}`);
  });
});

describe("the grade a brand-coloured control outside prose wears", () => {
  /* `brand-solid` is one value in both themes, so a grade losing its dark arm compiles, lints and
     renders — and sinks the hovered control into the card it sits on (`docs/frontend/spec.md :: I161`). */
  it("hovers to a value each theme declares for itself", () => {
    assert.match(BRAND_INK_OUTSIDE_PROSE, /(^|\s)hover:text-brand-solid(\s|$)/);
    assert.match(BRAND_INK_OUTSIDE_PROSE, /(^|\s)dark:hover:text-brand-solid-accent(\s|$)/);
  });

  /* The underline is what parts this from `textLink`, whose base carries one for every caller
     (`docs/frontend/spec.md :: I43`). With one here the two names reach the same control. */
  it("leaves the underline to the link recipe", () => {
    assert.doesNotMatch(BRAND_INK_OUTSIDE_PROSE, /underline/);
  });

  /* What the two dresses being one grade means, held in both directions: the drift a second spelling
     produced was one class at a time, and the class it dropped was the dark arm. */
  it("is the brand link's own grade with the underline taken off", () => {
    const nurImLink = [...classesOf(textLink({ tone: "brand" }))].filter((klasse) => !classesOf(BRAND_INK_OUTSIDE_PROSE).has(klasse));
    const nurAusserhalb = [...classesOf(BRAND_INK_OUTSIDE_PROSE)].filter((klasse) => !classesOf(textLink({ tone: "brand" })).has(klasse));

    assert.deepEqual(nurImLink, ["underline", "underline-offset-2"], "the link wears something over the grade that is not its underline");
    assert.deepEqual(nurAusserhalb, [], "the control grade carries a class the brand link does not");
  });

  /* Two copies of a three-class grade drift one class at a time, and the copy missing the dark arm
     renders fine in whichever theme its author had open. */
  it("is the only place the grade is spelled outside the link recipe", () => {
    // An exemption outliving the copy it was written for spares whatever is written in that file next.
    assert.match(readFileSync(RECIPE, "utf8"), SPELLS_THE_GRADE, `${rel(RECIPE)}: spells no brand grade`);

    const spellings = modulesUnder(SRC)
      .filter((file) => file !== RECIPE && SPELLS_THE_GRADE.test(readFileSync(file, "utf8")))
      .map(rel);

    assert.deepEqual(
      spellings,
      [],
      `these spell the brand grade inline instead of taking \`BRAND_INK_OUTSIDE_PROSE\`:\n  ${spellings.join("\n  ")}`,
    );
  });
});
