import assert from "node:assert/strict";

import { screen } from "@testing-library/react";

/**
 * A closed control read through the accessibility tree rather than a reader a test spells for itself: the overlay
 * `fl_frontend/src/shared/components/ui/Hint.tsx :: RefusalHint` lays over it carries all three facts.
 */
export function closedControl(name: string, reason: string | RegExp): HTMLElement {
  const covered = screen.getByRole("button", { name, description: reason });
  assert.equal(covered.getAttribute("aria-disabled"), "true", `„${name}“ carries its reason and is announced as usable`);

  return covered;
}

/**
 * Whether a reason stands in the panel's own flow, which a condition standing on the page is owed and a closure a
 * pick lifts is not (`docs/frontend/spec.md` §1.14).
 */
export function isInTheFlow(reason: string): boolean {
  return screen.queryByText((content) => content.includes(reason), { ignore: "script, style, [hidden]" }) !== null;
}
