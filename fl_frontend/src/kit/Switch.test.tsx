// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Switch } from "./Switch";

describe("a switch", () => {
  it("is described by its description, which a screen reader reads after its name", () => {
    render(
      <Switch
        label={COPY.shared.startelf}
        description={COPY.shared.bank}
      />,
    );
    const described = screen.getByRole("switch", { name: COPY.shared.startelf }).getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    expect(document.getElementById(described ?? "")?.textContent).toBe(COPY.shared.bank);
  });
});
