import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blankComments } from "./blankComments.ts";

describe("the source a sweep reads", () => {
  /* Over cases rather than over a tree: a stripper that quietly stopped removing anything would put
     every reader taking it back to matching a JSDoc, and no sweep of theirs would say so. */
  it("blanks every comment form and leaves the code beside them", () => {
    for (const comment of ['/** role="alert" */', '// role="alert"', '{/* role="alert" */}']) {
      assert.doesNotMatch(blankComments(comment), /role="alert"/, `${comment}: survived the stripper`);
    }

    assert.match(blankComments('<div role="alert">'), /role="alert"/, "the attribute did not survive the stripper");
    assert.match(blankComments('href="https://x.test" role="alert"'), /role="alert"/, "a URL inside a string ate the code after it");
    assert.match(
      blankComments('const label = "a // b"; role="alert"'),
      /role="alert"/,
      "a comment marker inside a string ate the code after it",
    );
    // Its own arm of the quote guard, and the one a class list reaches: a composed list is a template
    // literal here, and an arbitrary value holding a URL puts a `//` inside one.
    assert.match(
      blankComments('const klassen = `${basis} bg-[url(https://x.test/a.svg)]`; role="alert"'),
      /role="alert"/,
      "a comment marker inside a template literal ate the code after it",
    );
  });

  /* Asserted against the whole blanked string rather than by matching the code beside it: a span
     that slipped by one still hides every word the comment carries, so a `doesNotMatch` passes over
     the shift. */
  it("blanks the comment's own span where an astral character stands above it", () => {
    const comment = '/* role="alert" */';
    const source = `<span>\u{1F4EC}</span>\n{${comment}}\n<div role="alert">`;

    assert.equal(
      blankComments(source),
      `<span>\u{1F4EC}</span>\n{${" ".repeat(comment.length)}}\n<div role="alert">`,
      "the blanked span sits where the surrogate pair put it rather than where the source does",
    );
  });

  /* The shape that reaches `openingTag`: a comment between two attributes holds a `<` at brace depth
     zero, and the tag walk answers nothing at all for the control carrying it. */
  it("keeps a tag's own span intact where a comment stands inside it", () => {
    const tag = '<TextField\n  isRequired\n  // `<Input>` is dressed below\n  name="vorname">';

    assert.doesNotMatch(blankComments(tag), /<Input>/, "the comment's own tag survived the stripper");
    assert.match(blankComments(tag), /name="vorname">/, "the attribute after the comment went with it");
  });
});
