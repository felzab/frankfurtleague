"use client";

import { useEffect, useRef, useState } from "react";

import { appToast } from "@/shared/utils/appToast";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The one answer to a refusal no input can show, written where it is detected rather than at each
 * form: every editor reaching this state has the same thing to say and no reason to word it anew.
 */
const reportUnhandledFieldError = (): void => {
  appToast.danger("Speichern fehlgeschlagen", {
    description: buildRefusal({ reason: "Eine Angabe außerhalb dieses Formulars ist ungültig", repair: "Lade die Seite neu" }),
  });
};

/**
 * `reportValidity()` is what moves focus to the first rejected field, and must run from an effect: react-aria focuses
 * only from its `invalid` handler. It returning `true` means no input renders the path — hence the toast.
 */
export function useServerFieldErrors() {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (Object.keys(fieldErrors).length === 0) return;

    const form = formRef.current;
    if (!form) return;

    if (form.reportValidity()) reportUnhandledFieldError();
  }, [fieldErrors]);

  return { fieldErrors, setFieldErrors, formRef };
}

/** Whether a failed action result carried anything a field could display. */
export function hasFieldErrors(fieldErrors: FieldErrors | undefined): fieldErrors is FieldErrors {
  return !!fieldErrors && Object.keys(fieldErrors).length > 0;
}
