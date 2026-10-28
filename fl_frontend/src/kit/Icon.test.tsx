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
  // A rem class grows with the reader's font size; Lucide's `size` prop writes fixed pixels in place of
  // its 24-unit default, so a glyph sized that way carries the pixels in its attributes.
  it.each([
    [12, "size-3"],
    [16, "size-4"],
    [18, "size-4.5"],
  ] as const)("is set in rem at %i px, never as fixed pixels", (size, step) => {
    const svg = drawn(size);
    expect(svg.getAttribute("class")?.split(" ")).toContain(step);
    expect(svg.getAttribute("width")).not.toBe(String(size));
  });

  it("keeps the tick's weight at 12 px with a heavier stroke", () => {
    expect(drawn(12).getAttribute("stroke-width")).toBe("3");
    expect(drawn(16).getAttribute("stroke-width")).toBe("2");
  });
});
