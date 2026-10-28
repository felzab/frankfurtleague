// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Icon } from "./Icon";

/** The one glyph a render drew. */
const drawn = (size: 12 | 16 | 18) => {
  const { container } = render(
    <Icon
      glyph="haken"
      size={size}
    />,
  );
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("the icon drew no glyph");
  return svg;
};

describe("a glyph's size", () => {
  // A glyph grows with the reader's font size only while its size is a rem class; Lucide's `size` prop
  // writes fixed pixels in place of its 24-unit default, so a glyph sized that way carries the pixels in
  // its attributes, and at 200 % text it would stay small beside its words, which no check sees.
  it.each([12, 16, 18] as const)("at %i px is never set as fixed pixels", (size) => {
    expect(drawn(size).getAttribute("width")).not.toBe(String(size));
  });
});
