// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Chip } from "./Chip";

const { disqualifikation } = COPY.shared.austritt;

describe("a chip written as letters", () => {
  it("shows the letters to the eye alone and gives a screen reader the word they stand for", () => {
    const { container } = render(
      <Chip
        tone="danger"
        label={disqualifikation.kuerzel}
        spoken={disqualifikation.zustand}
      />,
    );
    const chip = within(container);

    expect(chip.getByText(disqualifikation.kuerzel).getAttribute("aria-hidden")).toBe("true");
    expect(chip.getByText(disqualifikation.zustand).classList).toContain("sr-only");
  });

  it("is read as its label where it names no spoken word", () => {
    const { container } = render(
      <Chip
        tone="danger"
        label={disqualifikation.label}
      />,
    );

    expect(container.querySelector("[aria-hidden]")).toBeNull();
    expect(container.textContent).toBe(disqualifikation.label);
  });
});
