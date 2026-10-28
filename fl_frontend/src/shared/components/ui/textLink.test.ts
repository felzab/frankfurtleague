import { describe, expect, it } from "vitest";

import { BRAND_INK_OUTSIDE_PROSE_CLASSES, textLink } from "./textLink.ts";

const classesOf = (recipe: string): Set<string> => new Set(recipe.split(" "));

describe("the one treatment a link inside text wears", () => {
  /* Colour alone is not a link to a reader who cannot see it, which is why the underline is in the
     BASE and not a variant a call site can decline. */
  it("underlines in the base, where no tone and no switch can decline it", () => {
    // `tone` alone: a second group is how the underline becomes something a call site turns off.
    expect(textLink.variantKeys, "the recipe grew a switch beside the tone").toStrictEqual(["tone"]);

    for (const tone of ["brand", "muted"] as const) {
      expect(textLink({ tone: tone }), `the ${tone} tone leaves the underline to a hover`).toMatch(/(^|\s)underline(\s|$)/);
    }
  });

  /* The two tones say different things — one carries the page's own action, one ranks below a
     primary — so they may not resolve to the same colour. */
  it("keeps the quiet tone distinct from the brand one", () => {
    expect(textLink({ tone: "brand" })).not.toBe(textLink({ tone: "muted" }));
    expect(textLink({ tone: "brand" })).toMatch(/text-brand/);
    expect(textLink({ tone: "muted" })).toMatch(/text-foreground-muted/);
  });
});

describe("the grade a brand-coloured control outside prose wears", () => {
  /* `brand-solid` is one value in both themes, so a grade losing its dark arm compiles, lints and
     renders — and sinks the hovered control into the card it sits on (`docs/frontend/spec.md :: I161`). */
  it("hovers to a value each theme declares for itself", () => {
    expect(BRAND_INK_OUTSIDE_PROSE_CLASSES).toMatch(/(^|\s)hover:text-brand-solid(\s|$)/);
    expect(BRAND_INK_OUTSIDE_PROSE_CLASSES).toMatch(/(^|\s)dark:hover:text-brand-solid-accent(\s|$)/);
  });

  /* The underline is what parts this from `textLink`, whose base carries one for every caller
     (`docs/frontend/spec.md :: I43`). With one here the two names reach the same control. */
  it("leaves the underline to the link recipe", () => {
    expect(BRAND_INK_OUTSIDE_PROSE_CLASSES).not.toMatch(/underline/);
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

    expect(inTheLinkOnly, "the link wears something over the grade that is not its underline").toStrictEqual([
      "underline",
      "underline-offset-2",
    ]);
    expect(outsideOnly, "the control grade carries a class the brand link does not").toStrictEqual([]);
  });
});
