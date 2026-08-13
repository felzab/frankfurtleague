/**
 * SHARED · the submit wiring every editor form uses
 *
 * `onSubmit` with `preventDefault`, and never React's `action` prop: React resets a form whose
 * `action` is a function on every submit, and react-aria turns that DOM reset into
 * `onChange(initialValue)` on each controlled field, which discards the draft in silence.
 *
 * See: `docs/frontend/spec.md` §1.10 "The submit is a handler, never a form action", invariant I32.
 */

import type { FormEvent } from "react";

/**
 * The submit handler a form passes to `onSubmit`.
 *
 * `preventDefault` is what keeps the page: with no React action on the form, an unhandled submit is
 * a real navigation. `run` is reached only for a draft the browser's own constraint validation has
 * already accepted, which is what lets it assume a payload worth sending.
 */
export function runOnSubmit(run: () => void): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    run();
  };
}
