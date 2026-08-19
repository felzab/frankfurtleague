import type { FormEvent } from "react";

/**
 * `onSubmit` with `preventDefault`, never React's `action` prop (I32 in `docs/frontend/spec.md`): React resets such a
 * form on every submit, and react-aria turns that DOM reset into `onChange(initialValue)` on each controlled field.
 */
export function runOnSubmit(run: () => void): (event: FormEvent<HTMLFormElement>) => void {
  return (event) => {
    event.preventDefault();
    run();
  };
}
