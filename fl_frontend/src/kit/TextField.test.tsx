// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
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
        autofill="username"
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("autocomplete")).toBe("username");
  });
});

describe("a digits field", () => {
  it("takes digits alone, a letter reading „Format: 123“ at the send", async () => {
    render(
      <Form onSubmit={(event) => event.preventDefault()}>
        <TextField
          label={COPY.shared.startelf}
          name="plz"
          kind="digits"
          width="C5"
        />
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.verb.speichern}
        />
      </Form>,
    );
    expect(screen.getByRole("textbox").getAttribute("pattern")).toBe("[0-9]*");
    await userEvent.type(screen.getByRole("textbox"), "6a");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));
    expect(screen.getByText(COPY.shared.feld.format(COPY.shared.feld.beispielZiffern))).toBeTruthy();
  });

  it("sets its unit after the field and outside it, hidden from assistive technology", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="digits"
        width="C5"
        unit={COPY.shared.einheit.euro}
      />,
    );
    const field = screen.getByRole("textbox");
    const unit = field.nextElementSibling;
    expect(unit?.textContent).toBe(COPY.shared.einheit.euro);
    expect(unit?.getAttribute("aria-hidden")).toBe("true");
    expect(field.contains(unit ?? null)).toBe(false);
  });

  it("leaves a text field's characters free", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="text"
        width="W3"
      />,
    );
    expect(screen.getByRole("textbox").hasAttribute("pattern")).toBe(false);
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

describe("a field's message line", () => {
  it("is always there, holding its place while it says nothing", () => {
    render(
      <TextField
        label={COPY.shared.startelf}
        kind="text"
        width="W3"
      />,
    );
    const field = screen.getByRole("textbox");
    expect(field.parentElement?.children).toHaveLength(3);
    expect(field.parentElement?.lastElementChild?.className.split(" ")).toContain("h-4");
  });

  it("appears with the error alone where the field reserves no line, as the sign-in's address field does", async () => {
    render(
      <Form onSubmit={(event) => event.preventDefault()}>
        <TextField
          label={COPY.anmeldung.adresse}
          kind="email"
          width="W3"
          line="withError"
        />
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.verb.speichern}
        />
      </Form>,
    );
    const field = screen.getByRole("textbox");
    expect(field.parentElement?.children).toHaveLength(2);

    await userEvent.type(field, "lena");
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));
    const message = screen.getByText(COPY.shared.feld.format(COPY.shared.feld.beispielAdresse));
    expect(field.parentElement?.lastElementChild?.contains(message)).toBe(true);
    expect(field.getAttribute("aria-describedby")?.split(" ")).toContain(message.id);
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
