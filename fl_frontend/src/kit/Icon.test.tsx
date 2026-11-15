// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Icon } from "./Icon";

describe("a glyph's size", () => {
  // A glyph grows with the reader's font size only while its size is a rem class; Lucide's `size` prop
  // writes fixed pixels in place of its 24-unit default, so a glyph sized that way carries the pixels in
  // its attributes, and at 200 % text it would stay small beside its words, which no check sees. Every size
  // takes the one path.
  it("is set as its rem class, never as fixed pixels", () => {
    const { container } = render(
      <Icon
        glyph="check"
        size={16}
      />,
    );
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.classList.contains("size-4"), "the 16-px glyph lost its rem class").toBe(true);
    expect(svg?.getAttribute("width")).not.toBe("16");
  });
});
