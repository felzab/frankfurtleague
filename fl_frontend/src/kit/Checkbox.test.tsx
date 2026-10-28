// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Checkbox } from "./Checkbox";

/** The drawn box beside the label: the element the focus file rings. */
const drawnBox = () => {
  const box = screen.getByText(COPY.shared.startelf).closest("label")?.querySelector("[data-kit-focus=box]");
  if (!(box instanceof HTMLElement)) throw new Error("the checkbox draws no box");
  return box;
};

function Pflicht({ checked = false }: { checked?: boolean }) {
  return (
    <Form onSubmit={(event) => event.preventDefault()}>
      <Checkbox
        label={COPY.shared.startelf}
        name="startelf"
        isRequired
        defaultSelected={checked}
      />
      <Button
        variant="primary"
        type="submit"
        label={COPY.shared.verb.speichern}
      />
    </Form>
  );
}

describe("a required checkbox", () => {
  it("draws its box with the red edge once a send finds it empty, as every other field shows its error", async () => {
    render(<Pflicht />);
    expect(drawnBox().className).toContain("border-border-control");

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));

    expect(screen.getByText(COPY.shared.feld.pflichtfeld)).toBeTruthy();
    expect(drawnBox().className).toContain("border-danger");
    expect(drawnBox().className).not.toContain("border-border-control");
  });

  it("fills a ticked box with the link green, the tick in the page's ground", () => {
    render(<Pflicht checked />);
    const classes = drawnBox().className.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["border-brand", "bg-brand", "text-bg"]));
  });

  it("carries the asterisk after its label, as every required field does, hidden from assistive technology", () => {
    render(<Pflicht />);
    const mark = screen.getByText(COPY.shared.startelf).querySelector(".text-danger");
    expect(mark?.textContent).toBe(" *");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    // The checkbox's name stays its label's words alone.
    expect(screen.getByRole("checkbox", { name: COPY.shared.startelf })).toBeTruthy();
  });

  it("sets its message on a 16-px line, a block in a grid as a field's line is, before and after a send", async () => {
    render(<Pflicht />);
    const line = () => {
      const row = screen.getByText(COPY.shared.startelf).closest("label");
      const holder = row?.nextElementSibling;
      if (!(holder instanceof HTMLElement)) throw new Error("the checkbox keeps no message line");
      return holder;
    };
    expect(line().className.split(" ")).toEqual(expect.arrayContaining(["col-start-2", "grid"]));
    expect(line().firstElementChild?.className.split(" ")).toContain("h-4");

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));

    const message = screen.getByText(COPY.shared.feld.pflichtfeld);
    expect(message.parentElement).toBe(line());
    expect(message.className.split(" ")).toContain("h-4");
  });

  it("draws its box at the 4-px corner, its 12-px tick 10 px from the label", () => {
    render(<Pflicht checked />);
    const box = drawnBox();
    expect(box.className.split(" ")).toContain("rounded-sm");
    expect(box.querySelector("svg")?.getAttribute("class")?.split(" ")).toContain("size-3");
    // The row passes on its field's columns, 10 px apart.
    expect(box.closest("label")?.parentElement?.className.split(" ")).toContain("gap-x-2.5");
  });
});
