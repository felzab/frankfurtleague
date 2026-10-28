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
