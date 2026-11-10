// @vitest-environment jsdom
import { useState } from "react";

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Segmented } from "./ChoiceButtons";
import { ComboBox } from "./ComboBox";
import { HeldForm } from "./HeldForm";
import { RecordRows } from "./RecordRows";
import { TextField } from "./TextField";

import type { Copy } from "@/core/copy";

type Goal = { side: string | null; spieler_id: string | null; minute: string };

const TEAM = COPY.shared.facts.team;
const MINUTE = COPY.admin.spiel.minute;
const REQUIRED = COPY.shared.field.required;
const REMOVE = COPY.shared.verb.remove;
const ADD = COPY.shared.verb.create;
const SIDES = [
  { id: "team1", label: { record: "AHO" } },
  { id: "team2", label: { record: "KAS" } },
];
const SQUAD = [{ id: "s9", label: { record: "9 · Mia Ahornberg" } }];
const GOALS: ReadonlyArray<Goal> = [
  { side: "team1", spieler_id: "s9", minute: "12" },
  { side: "team2", spieler_id: null, minute: "27" },
  { side: "team1", spieler_id: null, minute: "45+1" },
];

/** The label over a row by its number, as a page counts its rows. */
const rowLabel = (number: number) => COPY.admin.spiel.number(number);

/** The list in a form serving `errors`, as an editor's page holds it: the draft in state, the refusals by box. */
function Goals({ errors, locked }: { errors?: Readonly<Record<string, Copy>>; locked?: Copy }) {
  const [rows, setRows] = useState(GOALS);
  return (
    <HeldForm
      validationErrors={errors}
      onSend={() => undefined}>
      <RecordRows
        label={COPY.shared.tore}
        name="scorers"
        rows={rows}
        onChange={setRows}
        blank={{ side: null, spieler_id: null, minute: "" }}
        rowLabel={rowLabel}
        add={ADD}
        remove={REMOVE}
        locked={locked}
        errors={errors}
        cells={{
          lead: {
            field: "side",
            label: TEAM,
            control: ({ row, label, error, change }) => (
              <Segmented
                label={label}
                labelHidden
                choices={SIDES}
                value={row.side}
                errorMessage={error}
                onChange={(side) => change({ side, spieler_id: null })}
              />
            ),
          },
          figure: {
            field: "minute",
            label: MINUTE,
            control: ({ row, name, label, change }) => (
              <TextField
                label={label}
                labelHidden
                name={name}
                width="short"
                holds={5}
                kind="text"
                isRequired
                value={row.minute}
                onChange={(minute) => change({ minute })}
              />
            ),
          },
          main: {
            field: "spieler_id",
            label: COPY.shared.spieler,
            control: ({ row, name, label, change }) => (
              <ComboBox
                label={label}
                labelHidden
                name={name}
                options={SQUAD}
                value={row.spieler_id}
                onChange={(spieler_id) => change({ spieler_id })}
              />
            ),
          },
        }}
      />
    </HeldForm>
  );
}

const rowAt = (index: number) => screen.getByRole("group", { name: rowLabel(index + 1) });
const rowCount = () => screen.queryAllByRole("button", { name: REMOVE }).length;
const minuteOf = (row: HTMLElement) => within(row).getByRole<HTMLInputElement>("textbox", { name: MINUTE });
/** A row's first control, its team's first segment. */
const firstControl = (row: HTMLElement) => within(row).getAllByRole("radio")[0];

// The harm: a refusal shown under another row than the one refused.
describe("a refused row", () => {
  it.each([
    ["a field's", "scorers.1.minute", (row: HTMLElement) => minuteOf(row).getAttribute("aria-invalid")],
    ["a choice's", "scorers.1.side", (row: HTMLElement) => within(row).getByRole("radiogroup", { name: TEAM }).getAttribute("data-invalid")],
  ])("says %s refusal in its own row and marks the control", (_kind, box, marked) => {
    render(<Goals errors={{ [box]: REQUIRED }} />);
    const [first, second, third] = [rowAt(0), rowAt(1), rowAt(2)];

    expect(within(second).getByText(REQUIRED).hasAttribute("data-kit-message")).toBe(true);
    expect(within(first).queryByText(REQUIRED)).toBeNull();
    expect(within(third).queryByText(REQUIRED)).toBeNull();
    expect(marked(second)).toBe("true");
    expect(marked(first)).toBeNull();
  });
});

// The harm: a phone's row draws no label, so a control its cell's label does not reach is named by nothing at all.
describe("a row's controls", () => {
  it("are each named by their cell's label, on the row its label names", () => {
    render(<Goals />);
    const row = within(rowAt(2));

    expect(row.getByRole("radiogroup", { name: TEAM })).toBeTruthy();
    expect(row.getByRole("textbox", { name: MINUTE })).toBeTruthy();
    expect(row.getByRole("combobox", { name: COPY.shared.spieler })).toBeTruthy();
    expect(row.getByRole("button", { name: REMOVE, description: rowLabel(3) })).toBeTruthy();
  });
});

// The harm: the keyboard's place falling to `body` as a row arrives or leaves; and a row's fields kept by its place
// rather than by the row, so the mark of a field the send kept back stays behind on another row when one above leaves.
describe("the add and the remove control", () => {
  it("hand the keys to the new row's first control, and from a removed row to the row after it, then to the list", async () => {
    const { container } = render(<Goals />);

    await userEvent.click(screen.getByRole("button", { name: ADD }));
    expect(rowCount()).toBe(4);
    await waitFor(() => expect(document.activeElement).toBe(firstControl(rowAt(3))));

    // The send keeps the new row's empty minute back, which the row's own line says.
    act(() => container.querySelector("form")?.requestSubmit());
    expect(within(rowAt(3)).getByText(REQUIRED)).toBeTruthy();

    await userEvent.click(within(rowAt(1)).getByRole("button", { name: REMOVE }));
    expect(rowCount()).toBe(3);
    expect(minuteOf(rowAt(2)).getAttribute("aria-invalid")).toBe("true");
    expect(minuteOf(rowAt(1)).getAttribute("aria-invalid")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(firstControl(rowAt(1))));

    for (const _ of GOALS) await userEvent.click(within(rowAt(0)).getByRole("button", { name: REMOVE }));
    expect(rowCount()).toBe(0);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("group", { name: COPY.shared.tore })));
  });
});

// The harm: a list the draft takes no row in, a no-show's goals, still taking one on a press, which the send then refuses.
describe("a locked add control", () => {
  it("adds no row on a press and says why, the rows standing with their remove controls", async () => {
    const reason = COPY.shared.field.without(COPY.shared.tore);
    render(<Goals locked={reason} />);
    const add = screen.getByRole("button", { name: ADD, description: reason });

    await userEvent.click(add);
    expect(rowCount()).toBe(GOALS.length);
    expect(add.getAttribute("aria-disabled")).toBe("true");
  });
});
