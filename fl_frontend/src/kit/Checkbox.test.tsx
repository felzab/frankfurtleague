// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Checkbox, Tick } from "./Checkbox";

/** The drawn box beside the label: the element the focus file rings. */
const drawnBox = () => {
  const box = screen.getByText(COPY.shared.startelf).closest("label")?.querySelector("[data-kit-focus=box]");
  if (!(box instanceof HTMLElement)) throw new Error("the checkbox draws no box");
  return box;
};

function Required({ checked = false }: { checked?: boolean }) {
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
        label={COPY.shared.verb.save}
      />
    </Form>
  );
}

describe("a box alone in a column", () => {
  // The harm: a column of boxes a screen reader says as „Kontrollkästchen“ fourteen times, each drawing as it should.
  it("is named by its column's head and its row's name, and asks its owner of a press while it is locked", async () => {
    const onChange = vi.fn();
    render(
      <>
        <span id="head">{COPY.shared.startelf}</span>
        <span id="row">{COPY.shared.kader}</span>
        <Tick
          aria-labelledby="head row"
          isSelected={false}
          locked
          onChange={onChange}
        />
      </>,
    );

    await userEvent.click(screen.getByRole("checkbox", { name: `${COPY.shared.startelf} ${COPY.shared.kader}` }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  });
});

describe("a required checkbox", () => {
  // Read from the class, since jsdom draws nothing: the edge follows the field's invalid state, which only a
  // failed send reaches, so no look at the page shows it missing.
  it("draws its box with the red edge once a send finds it empty, as every other field shows its error", async () => {
    render(<Required />);
    expect(drawnBox().className).toContain("border-border-control");

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.save }));

    expect(screen.getByText(COPY.shared.field.required)).toBeTruthy();
    expect(drawnBox().className).toContain("border-danger");
    expect(drawnBox().className).not.toContain("border-border-control");
  });

  it("carries the asterisk after its label, as every required field does, hidden from assistive technology", () => {
    render(<Required />);
    const mark = screen.getByText(COPY.shared.startelf).lastElementChild;
    expect(mark?.textContent).toBe(" *");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    // The checkbox's name stays its label's words alone.
    expect(screen.getByRole("checkbox", { name: COPY.shared.startelf })).toBeTruthy();
  });
});
