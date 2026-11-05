// @vitest-environment jsdom
import { useState } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ComboBox } from "./ComboBox";

const SPIELORT = COPY.admin.spielort;

/** A venue field as the match editor holds it: its value held by the page, its text by the field. */
function SpielortField({ onCreate, onChange }: { onCreate: (typed: string) => void; onChange: (id: string | null) => void }) {
  const [value, setValue] = useState<string | null>("ost");
  return (
    <ComboBox
      label={SPIELORT.object}
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
      create={{ label: SPIELORT.createEntry, onCreate }}
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
    await userEvent.click(screen.getByRole("option", { name: SPIELORT.createEntry }));
    expect(onCreate).toHaveBeenCalledWith("Sportpark Süd");
    expect(onChange).not.toHaveBeenCalledWith(expect.anything());
  });
});
