"use client";

import { useEffect, useRef, useState } from "react";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * Holds the field errors a server action returned, and moves focus to the first field it rejected.
 *
 * The focus half is the part worth explaining. Feeding `fieldErrors` into HeroUI `Form`'s
 * `validationErrors` is enough to *show* each message: react-aria writes it onto the matching input
 * with `setCustomValidity` and marks it `aria-invalid`. It also auto-focuses the first invalid
 * input — but only from its handler for the native `invalid` event, and that event fires solely
 * during native form validation. A server action returns long after the submit is over, so nothing
 * raises it and focus stays on the submit button (react-aria 3.50,
 * `private/form/useFormValidation.mjs`).
 *
 * `reportValidity()` raises `invalid` on every invalid control, which is exactly the entry point
 * react-aria is listening for; its handler calls `preventDefault`, so the browser's own error bubble
 * never appears. It has to run from an effect rather than straight after `setFieldErrors`, because
 * react-aria applies the custom validity in a layout effect — calling it any earlier would find
 * every field still valid.
 *
 * Shared by `EntityForm` and `AdminEditSpielDataForm` so the two cannot drift: the reasoning above is
 * not something a reader would reconstruct from either call site.
 */
export function useServerFieldErrors() {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (Object.keys(fieldErrors).length > 0) formRef.current?.reportValidity();
  }, [fieldErrors]);

  return { fieldErrors, setFieldErrors, formRef };
}

/** Whether a failed action result carried anything a field can display. */
export function hasFieldErrors(fieldErrors: FieldErrors | undefined): fieldErrors is FieldErrors {
  return !!fieldErrors && Object.keys(fieldErrors).length > 0;
}
