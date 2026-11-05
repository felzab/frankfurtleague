import { describe, expect, it } from "vitest";

import { textLink } from "./textLink.ts";

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
