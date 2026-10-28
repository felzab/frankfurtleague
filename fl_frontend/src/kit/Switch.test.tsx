// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Form } from "react-aria-components/Form";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { RadioGroup } from "./RadioGroup";
import { Switch } from "./Switch";

/** The drawn part beside a label: the element the focus file rings. */
const drawnBox = (label: string) => {
  const box = screen.getByText(label).closest("label")?.querySelector("[data-kit-focus=box]");
  if (!(box instanceof HTMLElement)) throw new Error(`„${label}“ draws no box`);
  return box;
};

describe("a switch", () => {
  it("keeps a 1-px edge in the fields' edge colour around its track while off, so the track shows on white", () => {
    render(
      <Switch
        label={COPY.shared.startelf}
        description={COPY.shared.bank}
      />,
    );
    expect(drawnBox(COPY.shared.startelf).className.split(" ")).toEqual(expect.arrayContaining(["inset-ring", "inset-ring-border-control"]));
  });

  it("fills its track with the link green while on, with no edge", () => {
    render(
      <Switch
        label={COPY.shared.startelf}
        defaultSelected
      />,
    );
    const classes = drawnBox(COPY.shared.startelf).className.split(" ");
    expect(classes).toContain("bg-brand");
    expect(classes).not.toContain("inset-ring");
  });

  it("sets its description in the label's column, under the label rather than under the track", () => {
    render(
      <Switch
        label={COPY.shared.startelf}
        description={COPY.shared.bank}
      />,
    );
    const line = screen.getByText(COPY.shared.bank).parentElement;
    const row = screen.getByText(COPY.shared.startelf).closest("label");
    // A grid, so the description is a block on its own 16-px line, as a field's is.
    expect(line?.className.split(" ")).toEqual(expect.arrayContaining(["col-start-2", "grid"]));
    expect(screen.getByText(COPY.shared.bank).className.split(" ")).toContain("h-4");
    // The row spans the field's two columns and passes them on, so the label stands in the second.
    expect(row?.className.split(" ")).toEqual(expect.arrayContaining(["col-span-2", "grid-cols-subgrid"]));
  });
});

describe("a radio group", () => {
  it("fills the chosen answer's circle with the link green around a dot of the page's ground", () => {
    render(
      <RadioGroup
        label={COPY.shared.saison}
        choices={[
          { id: "startelf", label: COPY.shared.startelf },
          { id: "bank", label: COPY.shared.bank },
        ]}
        defaultValue="startelf"
      />,
    );
    const chosen = drawnBox(COPY.shared.startelf);
    expect(chosen.className.split(" ")).toEqual(expect.arrayContaining(["border-brand", "bg-brand"]));
    expect(chosen.firstElementChild?.className.split(" ")).toEqual(expect.arrayContaining(["size-2.5", "bg-bg"]));
    expect(drawnBox(COPY.shared.bank).firstElementChild).toBe(null);
  });

  it("draws every circle with the red edge once a send finds the required choice unmade, as a checkbox does", async () => {
    render(
      <Form onSubmit={(event) => event.preventDefault()}>
        <RadioGroup
          label={COPY.shared.saison}
          name="platz"
          isRequired
          choices={[
            { id: "startelf", label: COPY.shared.startelf },
            { id: "bank", label: COPY.shared.bank },
          ]}
        />
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.verb.speichern}
        />
      </Form>,
    );
    expect(drawnBox(COPY.shared.startelf).className.split(" ")).toContain("border-border-control");

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.speichern }));

    expect(screen.getByText(COPY.shared.feld.pflichtfeld)).toBeTruthy();
    for (const answer of [COPY.shared.startelf, COPY.shared.bank]) {
      expect(drawnBox(answer).className.split(" ")).toContain("border-danger");
      expect(drawnBox(answer).className.split(" ")).not.toContain("border-border-control");
    }
  });

  it("draws described answers as cards, each title over its line, the chosen card edged in the link green", () => {
    render(
      <RadioGroup
        label={COPY.shared.saison}
        layout="cards"
        choices={[
          { id: "startelf", label: COPY.shared.startelf, line: COPY.shared.saison },
          { id: "bank", label: COPY.shared.bank, line: COPY.shared.saison },
        ]}
        defaultValue="startelf"
      />,
    );
    const card = screen.getByText(COPY.shared.startelf).closest("label");
    expect(card?.className.split(" ")).toEqual(expect.arrayContaining(["data-selected:border-brand", "data-selected:inset-ring-brand"]));
    expect(card?.hasAttribute("data-selected")).toBe(true);
    expect(screen.getAllByText(COPY.shared.saison).length).toBe(3);
    expect(screen.getByRole("radio", { name: new RegExp(COPY.shared.bank) })).toBeTruthy();
  });
});
