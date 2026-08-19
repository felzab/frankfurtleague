"use client";

import { useEffect, useRef, useState } from "react";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * `reportValidity()` is what moves focus to the first rejected field, and must run from an effect: react-aria focuses
 * only from its `invalid` handler. It returning `true` means no input renders the path — hence `onUnhandledErrors`.
 */
export function useServerFieldErrors(onUnhandledErrors?: (errors: FieldErrors) => void) {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  // A ref so callers can pass an inline arrow without re-running the effect every render.
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
