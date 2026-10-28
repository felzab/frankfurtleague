// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Filters } from "./Filters";

// The filter row replaces the address through the app router, which no test mounts; nothing here navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined }), usePathname: () => "/" }));

describe("a labelled button with a leading glyph", () => {
  it("draws the glyph before its label, hidden from assistive technology", () => {
    render(
      <Button
        variant="secondary"
        leadingIcon="filter"
        label={COPY.shared.filter}
      />,
    );
    const button = screen.getByRole("button", { name: COPY.shared.filter });
    const glyph = button.firstElementChild;
    expect(glyph?.tagName.toLowerCase()).toBe("svg");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(button.lastChild?.textContent).toBe(COPY.shared.filter);
  });

  it("gives the glyph's place to the spinner while busy, so the button keeps its width", () => {
    render(
      <Button
        variant="secondary"
        leadingIcon="filter"
        label={COPY.shared.filter}
        isBusy
      />,
    );
    const button = screen.getByRole("button", { name: COPY.shared.filter });
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByRole("progressbar", { name: COPY.shared.laedt })).toBeTruthy();
  });
});

describe("a phone's filter button", () => {
  it("leads „Filter“ with the filter glyph and names no count", () => {
    render(<Filters filters={[]} />);
    // The desktop row holds no button; the phone's is the one „Filter“ names.
    const button = screen.getByRole("button", { name: COPY.shared.filter });
    expect(button.querySelector("svg")).not.toBe(null);
    expect(button.textContent).toBe(COPY.shared.filter);
  });
});
