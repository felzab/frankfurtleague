import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BRAND_INK_OUTSIDE_PROSE_CLASSES, textLink } from "./textLink.ts";

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
});

describe("the grade a brand-coloured control outside prose wears", () => {
  /* `brand-solid` is one value in both themes, so a grade losing its dark arm compiles, lints and
     renders — and sinks the hovered control into the card it sits on (`docs/frontend/spec.md :: I161`). */
  it("hovers to a value each theme declares for itself", () => {
    assert.match(BRAND_INK_OUTSIDE_PROSE_CLASSES, /(^|\s)hover:text-brand-solid(\s|$)/);
    assert.match(BRAND_INK_OUTSIDE_PROSE_CLASSES, /(^|\s)dark:hover:text-brand-solid-accent(\s|$)/);
  });

  /* The underline is what parts this from `textLink`, whose base carries one for every caller
     (`docs/frontend/spec.md :: I43`). With one here the two names reach the same control. */
  it("leaves the underline to the link recipe", () => {
    assert.doesNotMatch(BRAND_INK_OUTSIDE_PROSE_CLASSES, /underline/);
  });

  /* What the two dresses being one grade means, held in both directions: the drift a second spelling
     produced was one class at a time, and the class it dropped was the dark arm. */
  it("is the brand link's own grade with the underline taken off", () => {
    const inTheLinkOnly = [...classesOf(textLink({ tone: "brand" }))].filter(
      (className) => !classesOf(BRAND_INK_OUTSIDE_PROSE_CLASSES).has(className),
    );
    const outsideOnly = [...classesOf(BRAND_INK_OUTSIDE_PROSE_CLASSES)].filter(
      (className) => !classesOf(textLink({ tone: "brand" })).has(className),
    );

    assert.deepEqual(inTheLinkOnly, ["underline", "underline-offset-2"], "the link wears something over the grade that is not its underline");
    assert.deepEqual(outsideOnly, [], "the control grade carries a class the brand link does not");
  });
});
