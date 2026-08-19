import type { KeyboardEvent } from "react";

/**
 * Enter belongs to these: a `button`, a `textarea`, and an OPEN combobox input, where react-aria
 * commits the highlighted option itself. A *closed* one is deliberately not exempt — there Enter
 * reaches the implicit submit this guard stops.
 */
const handlesEnterItself = (e: KeyboardEvent) =>
  e.target instanceof Element && e.target.closest('button, textarea, [role="combobox"][aria-expanded="true"]') !== null;

/**
 * Nested controls inside the editor's `<Form action>` must not submit it on Enter. **Both halves are
 * load-bearing**: `preventDefault` stops the implicit submit, `stopPropagation` stops the event
 * reaching the outer `<Form>`.
 */
export const suppressEnterSubmit = (e: KeyboardEvent) => {
  if (e.key !== "Enter" || handlesEnterItself(e)) return;
  e.preventDefault();
  e.stopPropagation();
};
