// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { TextField } from "./TextField";

const classesOf = (element: HTMLElement) => element.className.split(" ");

describe("a field's inset", () => {
  it.each(["W1", "W2"] as const)("is 10 px in the short width %s", (width) => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="digits"
        width={width}
      />,
    );
    const classes = classesOf(screen.getByRole("textbox"));
    expect(classes).toContain("px-2.5");
    expect(classes).not.toContain("px-3");
  });

  it("is 12 px in the column's width", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="text"
        width="W3"
      />,
    );
    const classes = classesOf(screen.getByRole("textbox"));
    expect(classes).toContain("px-3");
    expect(classes).not.toContain("px-2.5");
  });

  it("gives a paragraph at least 104 px", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="text"
        width="W4"
      />,
    );
    expect(classesOf(screen.getByRole("textbox"))).toContain("min-h-26");
  });
});
