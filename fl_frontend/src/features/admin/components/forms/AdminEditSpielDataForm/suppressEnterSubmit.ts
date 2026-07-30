import type { KeyboardEvent } from "react";

/**
 * Nested controls inside `AdminEditSpielDataForm`'s `<Form action>` must not submit it on Enter.
 *
 * This guard existed at six sites in three different spellings — two of them `onKeyDown` with only
 * `preventDefault()` and no `stopPropagation()` (R2 §3.9), so a reader could not tell which half was
 * load-bearing. Both halves are: `preventDefault` stops the implicit submit, `stopPropagation` stops
 * the event reaching the outer `<Form>`.
 */
export const suppressEnterSubmit = (e: KeyboardEvent) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  e.stopPropagation();
};

/**
 * The inline-create variant: swallows Enter exactly as above, then submits the **inline draft**.
 * The suppression happens first and unconditionally, so Enter can never reach the parent form.
 */
export const submitInlineOnEnter = (submit: () => void) => (e: KeyboardEvent) => {
  if (e.key !== "Enter") return;
  e.preventDefault();
  e.stopPropagation();
  submit();
};
