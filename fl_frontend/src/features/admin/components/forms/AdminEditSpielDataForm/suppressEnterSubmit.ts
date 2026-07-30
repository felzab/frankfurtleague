import type { KeyboardEvent } from "react";

/**
 * True when the element under the caret handles Enter itself and must keep it:
 * - a `button` — Enter activates it, and every button inside these guarded regions is
 *   `type="button"`, which can never submit the surrounding form;
 * - an open combobox input — react-aria uses Enter to commit the highlighted option and calls
 *   `preventDefault()` itself, so no implicit submit can escape. (A *closed* combobox input is
 *   deliberately not exempt: there Enter would fall through to the browser's implicit form
 *   submission, which is exactly what this guard exists to stop.)
 *
 * Without this exemption, Enter on "Abbrechen" inside the inline-create form submitted the draft
 * instead of cancelling, and Enter could not open the Autocomplete triggers at all — a keyboard
 * trap the original per-site copies shared.
 */
const handlesEnterItself = (e: KeyboardEvent) =>
  e.target instanceof Element && e.target.closest('button, textarea, [role="combobox"][aria-expanded="true"]') !== null;

/**
 * Nested controls inside `AdminEditSpielDataForm`'s `<Form action>` must not submit it on Enter.
 *
 * This guard existed at six sites in three different spellings — two of them `onKeyDown` with only
 * `preventDefault()` and no `stopPropagation()` (R2 §3.9), so a reader could not tell which half is
 * load-bearing. Both halves are: `preventDefault` stops the implicit submit, `stopPropagation`
 * stops the event reaching the outer `<Form>`.
 */
export const suppressEnterSubmit = (e: KeyboardEvent) => {
  if (e.key !== "Enter" || handlesEnterItself(e)) return;
  e.preventDefault();
  e.stopPropagation();
};

/**
 * The inline-create variant: swallows Enter exactly as above, then submits the **inline draft**.
 * The suppression happens first and unconditionally for non-exempt targets, so Enter can never
 * reach the parent form.
 */
export const submitInlineOnEnter = (submit: () => void) => (e: KeyboardEvent) => {
  if (e.key !== "Enter" || handlesEnterItself(e)) return;
  e.preventDefault();
  e.stopPropagation();
  submit();
};
