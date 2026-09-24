import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { laufendDot } from "./laufendDot.ts";

import type { LaufendDotStep } from "./laufendDot.ts";

/**
 * Spelled out rather than read off the recipe, which is what the cases below grade: a list derived
 * from it would grade a third step by nothing and a retired one not at all.
 */
const STEPS: readonly LaufendDotStep[] = ["xxs", "xs"];

/* Matched as whole tokens: `bg-brand/20` is the page loader's halo and `bg-brand-solid` is a fill,
   and a substring reader grades both as this dot. */
const GRADE = ["bg-brand", "animate-ping"];

const carriesTheGrade = (written: string): boolean => {
  const tokens = written.split(/\s+/);
  return GRADE.every((token) => tokens.includes(token));
};

describe("the mark a running season wears on both surfaces", () => {
  /* A step that dropped the grade would paint an unanimated dot in whatever colour it inherited,
     which renders and reports nothing. */
  it("carries the grade and its own size into every step it composes", () => {
    for (const step of STEPS) {
      const tokens = laufendDot(step).split(" ");

      assert.ok(carriesTheGrade(laufendDot(step)), `\`${step}\` composes to ${laufendDot(step)}, which drops the grade`);
      assert.ok(
        tokens.some((token) => token.startsWith("size-")),
        `\`${step}\` composes to ${laufendDot(step)}, which paints a dot with no size`,
      );
    }
  });

  /* Two sizes for two type steps, so an ornament never outweighs the word beside it; one size for
     both would be a parameter nothing reads. */
  it("gives the two steps different sizes", () => {
    assert.notEqual(laufendDot("xxs"), laufendDot("xs"), "both steps compose the same dot");
  });
});
