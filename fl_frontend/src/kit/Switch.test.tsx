// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Switch } from "./Switch";

describe("a locked switch", () => {
  // The harm: a switch its record holds fixed, such as a match's result before its season's start, still flips and
  // reveals fields whose save the write refuses, while its lock mark says it cannot.
  it("stands disabled and never flips", async () => {
    const onChange = vi.fn();
    render(
      <Switch
        label={COPY.shared.withObject(COPY.admin.spiel.ergebnis, "enter")}
        isLocked
        onChange={onChange}
      />,
    );
    const control = screen.getByRole<HTMLInputElement>("switch");

    // A person's click, as a browser delivers it: a bare dispatched event reaches even a disabled input in jsdom.
    await userEvent.click(control);

    expect(control.getAttribute("aria-readonly")).toBe("true");
    expect(onChange).not.toHaveBeenCalled();
  });
});
