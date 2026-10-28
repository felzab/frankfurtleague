// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Segmented, ToggleBoxes } from "./ChoiceButtons";

const CHOICES = [
  { id: "startelf", label: COPY.shared.startelf },
  { id: "bank", label: COPY.shared.bank },
];

const classesOf = (name: string) => screen.getByRole("button", { name }).className.split(" ");

describe("a segmented control", () => {
  it("is one group named by its label, its chosen segment raised out of the frame inside the control edge", () => {
    render(
      <Segmented
        label={COPY.shared.saison}
        choices={CHOICES}
        defaultValue="startelf"
      />,
    );
    expect(screen.getByRole("radiogroup", { name: COPY.shared.saison })).toBeTruthy();
    expect(screen.getByRole("radio", { name: COPY.shared.startelf }).getAttribute("aria-checked")).toBe("true");
    const segment = screen.getByRole("radio", { name: COPY.shared.startelf }).className.split(" ");
    expect(segment).toEqual(expect.arrayContaining(["data-selected:bg-bg-muted", "data-selected:border-border-control"]));
    expect(screen.getByRole("radiogroup").className.split(" ")).toContain("bg-bg-surface");
  });

  it("hands back the answer chosen and never lets the choice go empty", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label={COPY.shared.saison}
        choices={CHOICES}
        defaultValue="startelf"
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: COPY.shared.bank }));
    expect(onChange).toHaveBeenLastCalledWith("bank");
    await userEvent.click(screen.getByRole("radio", { name: COPY.shared.bank }));
    expect(screen.getByRole("radio", { name: COPY.shared.bank }).getAttribute("aria-checked")).toBe("true");
  });
});

const GLYPHS = [
  { id: "dark", glyph: "dunkel", label: COPY.vorlage.darstellung.dunkel },
  { id: "light", glyph: "hell", label: COPY.vorlage.darstellung.hell },
] as const;

describe("a segmented control of glyphs", () => {
  it("names each segment for assistive technology and in its tooltip, the glyph muted until chosen", async () => {
    render(
      <Segmented
        label={COPY.seite.darstellung}
        choices={GLYPHS}
        value="dark"
      />,
    );
    const chosen = screen.getByRole("radio", { name: COPY.vorlage.darstellung.dunkel });
    expect(chosen.getAttribute("aria-checked")).toBe("true");
    expect(chosen.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(chosen.textContent).toBe("");
    expect(chosen.className.split(" ")).toEqual(expect.arrayContaining(["w-9", "text-fg-muted", "data-selected:text-fg"]));
    expect(chosen.className.split(" ")).not.toContain("min-w-16");

    // Keyboard focus opens the tooltip, as it does on an icon-only button.
    await userEvent.tab();
    expect(screen.getByRole("tooltip").textContent).toBe(COPY.vorlage.darstellung.dunkel);
  });

  it("stands alone in a row the caller writes, named by its label, and chooses none while the answer is not known", () => {
    const { container } = render(
      <Segmented
        placement="inline"
        label={COPY.seite.darstellung}
        choices={GLYPHS}
        value={null}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: COPY.seite.darstellung });
    expect(container.firstElementChild).toBe(group);
    expect(screen.queryByText(COPY.seite.darstellung)).toBeNull();
    expect(screen.getAllByRole("radio").every((radio) => radio.getAttribute("aria-checked") === "false")).toBe(true);
  });
});

describe("toggle boxes", () => {
  it("take several answers, each chosen box lifted with a stronger edge", async () => {
    const onChange = vi.fn();
    render(
      <ToggleBoxes
        label={COPY.shared.saison}
        choices={CHOICES}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.startelf }));
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.bank }));
    expect(onChange).toHaveBeenLastCalledWith(["startelf", "bank"]);
    expect(screen.getByRole("button", { name: COPY.shared.bank }).getAttribute("aria-pressed")).toBe("true");
    expect(classesOf(COPY.shared.bank)).toEqual(expect.arrayContaining(["data-selected:bg-bg-surface", "data-selected:border-fg-muted"]));
  });
});
