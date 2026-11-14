// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Switch } from "./Switch";

describe("a locked switch", () => {
  // The harm: a switch its record holds fixed, such as a match's result before its season's start, still flips and
  // reveals fields whose save the write refuses, while its lock mark says it cannot.
  it("stands read-only and never flips", async () => {
    const onChange = vi.fn();
    render(
      <Switch
        label={COPY.shared.withObject(COPY.admin.spiel.ergebnis, "enter")}
        isLocked
        onChange={onChange}
      />,
    );
    const control = screen.getByRole<HTMLInputElement>("switch");

    // A person's click, as a browser delivers it.
    await userEvent.click(control);

    expect(control.getAttribute("aria-readonly")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });

  // The harm: the row is a grid of the track and its words, and a mark standing as a third item wraps under the track,
  // away from the label it marks. No layout runs here, so the case reads the markup that decides it.
  it("holds its lock mark with its label, apart from the track", () => {
    const label = COPY.shared.withObject(COPY.admin.spiel.ergebnis, "enter");
    render(
      <Switch
        label={label}
        isLocked
      />,
    );
    const words = screen.getByText(label);

    expect(words.querySelector("svg")).not.toBeNull();
    expect(words.querySelector("[data-kit-focus]")).toBeNull();
  });
});
