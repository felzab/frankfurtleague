/**
 * SPIELE · the Enter-key guard for the nested match form
 *
 * `AdminEditSpielDataForm` nests controls inside a `<Form action>`, where Enter would otherwise
 * trigger the browser's implicit submit. This is the single definition of that guard, and it serves
 * every site in the form that needs it.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • `preventDefault` and `stopPropagation` are both load-bearing and neither may be dropped: the
 *     first stops the implicit submit, the second stops the event reaching the outer `<Form>`.
 *   • The exemption list is deliberately narrow. A *closed* combobox input is not exempt — there Enter
 *     falls through to implicit submission, which is the case this guard exists for.
 */

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
 * Without this exemption, Enter could not open the Autocomplete triggers at all — a keyboard trap the
 * original per-site copies shared.
 */
const handlesEnterItself = (e: KeyboardEvent) =>
  e.target instanceof Element && e.target.closest('button, textarea, [role="combobox"][aria-expanded="true"]') !== null;

/**
 * Nested controls inside `AdminEditSpielDataForm`'s `<Form action>` must not submit it on Enter.
 *
 * This guard existed at six sites in three different spellings — two of them `onKeyDown` with only
 * `preventDefault()` and no `stopPropagation()`, so a reader could not tell which half is
 * load-bearing. Both halves are: `preventDefault` stops the implicit submit, `stopPropagation`
 * stops the event reaching the outer `<Form>`.
 */
export const suppressEnterSubmit = (e: KeyboardEvent) => {
  if (e.key !== "Enter" || handlesEnterItself(e)) return;
  e.preventDefault();
  e.stopPropagation();
};
