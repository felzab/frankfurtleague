import { screen } from "@testing-library/react";
import { expect } from "vitest";

/**
 * A closed control read through the accessibility tree rather than a reader a test spells for itself: the overlay
 * `fl_frontend/src/shared/components/ui/Hint.tsx :: RefusalHint` lays over it carries all three facts.
 */
export function closedControl(name: string, reason: string | RegExp): HTMLElement {
  const covered = screen.getByRole("button", { name, description: reason });
  expect(covered.getAttribute("aria-disabled"), `„${name}“ carries its reason and is announced as usable`).toBe("true");

  return covered;
}
