// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Select } from "./Select";

describe("a select's chosen value", () => {
  it("is marked as a form's value: the row tinted in the link green, its check at the end", async () => {
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
    expect(chosen.className.split(" ")).toContain("data-selected:bg-brand/12");
    expect(chosen.className).not.toContain("data-selected:text-brand");
    expect(chosen.querySelector("svg")).not.toBe(null);
    expect(screen.getByRole("option", { name: "Helmholtz" }).querySelector("svg")).toBe(null);
  });
});
