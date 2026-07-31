"use client";

import { useEffect, useRef, useState } from "react";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * Holds the field errors a server action returned, moves focus to the first field it rejected, and
 * reports back when a message had nowhere to land.
 *
 * **The focus half.** Feeding `fieldErrors` into HeroUI `Form`'s `validationErrors` is enough to
 * *show* each message: react-aria writes it onto the matching input with `setCustomValidity` and
 * marks it `aria-invalid`. It also auto-focuses the first invalid input — but only from its handler
 * for the native `invalid` event, and that event fires solely during native form validation. A
 * server action returns long after the submit is over, so nothing raises it and focus stays on the
 * submit button (react-aria 3.50, `private/form/useFormValidation.mjs`). `reportValidity()` raises
 * `invalid` on every invalid control, which is exactly the entry point react-aria is listening for;
 * its handler calls `preventDefault`, so the browser's own error bubble never appears. It has to run
 * from an effect rather than straight after `setFieldErrors`, because react-aria applies the custom
 * validity in a layout effect — calling it any earlier would find every field still valid.
 *
 * **The `onUnhandledErrors` half.** A key only renders if some mounted field carries that exact
 * `name`; react-stately looks server errors up as `serverErrors[name]`. A payload can be rejected on
 * a path no field renders — the admin match form validates `spiel_id`, `is_canceled` and both teams'
 * `shorthand`, none of which is an input — and then the message would go nowhere while the caller,
 * seeing a non-empty `fieldErrors`, also suppressed its toast. The submit would fail in complete
 * silence. `reportValidity()` returns `true` when nothing is invalid, which is precisely that case,
 * so the callback fires and the caller can fall back to the toast.
 *
 * Shared by `EntityForm` and `AdminEditSpielDataForm` so the two cannot drift.
 */
export function useServerFieldErrors(onUnhandledErrors?: (errors: FieldErrors) => void) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // Kept in a ref so callers can pass an inline arrow without re-running the effect every render.
  const onUnhandledRef = useRef(onUnhandledErrors);
  useEffect(() => {
    onUnhandledRef.current = onUnhandledErrors;
  });

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;

    const form = formRef.current;
    if (!form) return;

    if (form.reportValidity()) onUnhandledRef.current?.(fieldErrors);
  }, [fieldErrors]);

  return { fieldErrors, setFieldErrors, formRef };
}

/** Whether a failed action result carried anything a field could display. */
export function hasFieldErrors(fieldErrors: FieldErrors | undefined): fieldErrors is FieldErrors {
  return !!fieldErrors && Object.keys(fieldErrors).length > 0;
}
