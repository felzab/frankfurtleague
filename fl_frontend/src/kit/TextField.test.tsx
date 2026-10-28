// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { TextField } from "./TextField";

const classesOf = (element: HTMLElement) => element.className.split(" ");

describe("an address field's autofill", () => {
  it("offers the person's address by default", () => {
    render(
      <TextField
        label={COPY.anmeldung.adresse}
        kind="email"
        width="W3"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("email");
  });

  it("takes the token it is given, as the sign-in's account name", () => {
    render(
      <TextField
        label={COPY.anmeldung.adresse}
        kind="email"
        width="W3"
        autofill="username webauthn"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("username webauthn");
  });
});

describe("a field's frame", () => {
  it("is filled with the surface inside its control edge", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="text"
        width="W3"
      />,
    );
    const classes = classesOf(screen.getByRole("textbox"));
    expect(classes).toEqual(expect.arrayContaining(["bg-bg-surface", "border-border-control"]));
    expect(classes).not.toContain("bg-bg");
  });
});

describe("a field's width", () => {
  it.each([
    ["C2", "w-[calc(3ch+1.375rem)]"],
    ["C5", "w-[calc(6ch+1.375rem)]"],
  ] as const)("counts %s in characters, one more for the caret, so it grows with the font size", (width, step) => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="digits"
        width={width}
      />,
    );
    expect(classesOf(screen.getByRole("textbox"))).toContain(step);
  });
});

describe("a field's inset", () => {
  it.each(["C2", "C5"] as const)("is 10 px in the short width %s", (width) => {
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
