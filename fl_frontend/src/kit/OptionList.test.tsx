// @vitest-environment jsdom
import { useState } from "react";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ComboBox } from "./ComboBox";
import { Select } from "./Select";

const ORT = COPY.verwaltung.spielort;

/** A venue field as the match editor holds it: its value held by the page, its text by the field. */
function VenueField({ onCreate, onChange }: { onCreate: (typed: string) => void; onChange?: (id: string | null) => void }) {
  const [value, setValue] = useState<string | null>("ost");
  return (
    <ComboBox
      label={ORT.objekt}
      options={[
        { id: "ost", label: "Sportplatz Ost" },
        { id: "west", label: "Sportplatz West" },
        { id: "halle", label: "Sporthalle Nord" },
      ]}
      value={value}
      onChange={(id) => {
        setValue(id);
        onChange?.(id);
      }}
      create={{ label: ORT.anlegenEintrag, onCreate }}
    />
  );
}

const typeInto = async (text: string) => {
  const input = screen.getByRole("combobox");
  await userEvent.clear(input);
  await userEvent.type(input, text);
};

describe("a combo box's create entry", () => {
  it("stands last under the hairline after the matches, and alone where nothing matches", async () => {
    render(<VenueField onCreate={() => undefined} />);
    await typeInto("Sportplatz");
    const listbox = screen.getByRole("listbox");
    const names = screen.getAllByRole("option").map((option) => option.textContent);
    expect(names).toEqual(["Sportplatz Ost", "Sportplatz West", ORT.anlegenEintrag]);
    expect(listbox.lastElementChild?.previousElementSibling?.getAttribute("role")).toBe("separator");

    await typeInto("Sportpark Süd");
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([ORT.anlegenEintrag]);
  });

  it("filters a record named as the entry like any other record", async () => {
    render(
      <ComboBox
        label={ORT.objekt}
        options={[{ id: "gleich", label: ORT.anlegenEintrag }]}
        create={{ label: ORT.anlegenEintrag, onCreate: () => undefined }}
      />,
    );
    await typeInto("Sportpark Süd");
    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("hands on the typed text and leaves the value as it was", async () => {
    const onCreate = vi.fn();
    const onChange = vi.fn();
    render(
      <VenueField
        onCreate={onCreate}
        onChange={onChange}
      />,
    );
    await typeInto("Sportpark Süd");
    await userEvent.click(screen.getByRole("option", { name: ORT.anlegenEintrag }));
    expect(onCreate).toHaveBeenCalledWith("Sportpark Süd");
    expect(onChange).not.toHaveBeenCalledWith(expect.anything());
  });

  it("is reached by the arrow keys and chosen with Enter", async () => {
    const onCreate = vi.fn();
    render(<VenueField onCreate={onCreate} />);
    await typeInto("Sportpark Süd");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onCreate).toHaveBeenCalledWith("Sportpark Süd");
  });

  it("hands on no name where the field shows the chosen venue untouched", async () => {
    const onCreate = vi.fn();
    render(<VenueField onCreate={onCreate} />);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(ORT.objekt) }));
    await userEvent.click(screen.getByRole("option", { name: ORT.anlegenEintrag }));
    expect(onCreate).toHaveBeenCalledWith("");
  });

  it("clears the value when the text is cleared by hand, the value being the page's", async () => {
    const onChange = vi.fn();
    render(
      <VenueField
        onCreate={() => undefined}
        onChange={onChange}
      />,
    );
    await userEvent.clear(screen.getByRole("combobox"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe("a select's chosen value", () => {
  it("is marked as a form's value, its check at the end", async () => {
    render(
      <Select
        label={COPY.shared.saison}
        options={[
          { id: "a", label: "Goethe" },
          { id: "b", label: "Helmholtz" },
        ]}
        defaultValue="a"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: new RegExp(COPY.shared.saison) }));

    const chosen = screen.getByRole("option", { name: "Goethe" });
    expect(chosen.getAttribute("aria-selected")).toBe("true");
    expect(chosen.querySelector("svg")).not.toBe(null);
    expect(screen.getByRole("option", { name: "Helmholtz" }).querySelector("svg")).toBe(null);
  });
});
