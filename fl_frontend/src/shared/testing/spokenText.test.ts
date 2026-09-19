import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shownText, spokenText } from "./spokenText.ts";

describe("the two readers of one markup", () => {
  /* A reader ending the hidden element at its first closing tag of that name leaves the rest of it
     standing, and the tests reading through it would hear text the page hides. */
  it("take out a hidden element whole, a nested element of its own name included", () => {
    const html = '<p>Vor<span aria-hidden="true">a<span>b</span>c</span>nach</p>';

    assert.equal(spokenText(html), "Vornach");
    assert.equal(shownText(html), "Vorabcnach");
  });

  it("take out a self-closing hidden element without swallowing what follows it", () => {
    assert.equal(spokenText('<p>eins<input aria-hidden="true"/>zwei</p>'), "einszwei");
  });

  it("hear what only a screen reader is given, and show what only the eye is", () => {
    const html = '<span>5:4 <span aria-hidden="true">i. E.</span><span class="sr-only">im Elfmeterschießen</span></span>';

    assert.equal(spokenText(html), "5:4 im Elfmeterschießen");
    assert.equal(shownText(html), "5:4 i. E.");
  });

  // `sr-only` as one token among others, and never a class that only contains the letters.
  it("read the sr-only class as a token", () => {
    assert.equal(shownText('<span class="a sr-only b">weg</span><span class="not-sr-only">da</span>'), "da");
  });
});
