"use client";

/**
 * SHARED · server-rejected fields
 *
 * The bridge between a server action's `fieldErrors` and react-aria's client-side validation,
 * shared by `EntityForm` and `AdminEditSpielDataForm` so the two cannot drift.
 *
 * Invariants:
 * - `reportValidity()` runs from an effect — earlier, react-aria has not applied custom validity yet.
 * - A toast-suppressing caller must handle `onUnhandledErrors`, or an unrendered path fails silently.
 */
import { useEffect, useRef, useState } from "react";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * Holds the field errors a server action returned, moves focus to the first field it rejected, and
 * reports back when a message had nowhere to land.
 *
 * `reportValidity()` is what moves focus. HeroUI's `validationErrors` shows each message but only
 * auto-focuses from react-aria's handler for the native `invalid` event, which fires during native
 * validation — long over by the time a server action returns. `reportValidity()` raises that event,
 * and react-aria's handler suppresses the browser's own error bubble.
 *
 * It returning `true` means nothing was invalid, i.e. the payload was rejected on a path no input
 * renders — `spiel_id` and `is_canceled` on the match form, for instance. That is what
 * `onUnhandledErrors` is for.
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
