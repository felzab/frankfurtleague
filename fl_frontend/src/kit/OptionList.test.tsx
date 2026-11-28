// @vitest-environment jsdom
import { useState } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";

import { ComboBox } from "./ComboBox";

const SPIELORT = COPY.spielplan.fact.spielort;
const CREATE = COPY.shared.withObject(SPIELORT, "create");

/** A venue field as the match editor holds it: its value held by the page, its text by the field. */
function SpielortField({ onCreate, onChange }: { onCreate: (typed: string) => void; onChange: (id: string | null) => void }) {
  const [value, setValue] = useState<string | null>("ost");
  return (
    <ComboBox
      label={SPIELORT}
      options={[
        { id: "ost", label: { record: "Sportplatz Ost" } },
        { id: "west", label: { record: "Sportplatz West" } },
        { id: "halle", label: { record: "Sporthalle Nord" } },
      ]}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange(id);
      }}
      create={{ label: CREATE, onCreate }}
    />
  );
}

describe("a combo box's create entry", () => {
  // The harm: a create press changing the field's value, which the next save of any other field carries along unasked.
  it("hands on the typed text and leaves the value as it was", async () => {
    const onCreate = vi.fn();
    const onChange = vi.fn();
    render(
      <SpielortField
        onCreate={onCreate}
        onChange={onChange}
      />,
    );
    const input = screen.getByRole("combobox");
    await userEvent.clear(input);
    await userEvent.type(input, "Sportpark Süd");
    await userEvent.click(screen.getByRole("option", { name: CREATE }));
    expect(onCreate).toHaveBeenCalledWith("Sportpark Süd");
    expect(onChange).not.toHaveBeenCalledWith(expect.anything());
  });
});
