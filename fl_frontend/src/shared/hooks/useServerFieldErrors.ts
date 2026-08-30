"use client";

import { useEffect, useRef, useState } from "react";

import { appToast } from "@/shared/utils/appToast";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The one answer to a refusal no input can show, written where it is detected rather than at each
 * form: every editor reaching this state has the same thing to say and no reason to word it anew.
 */
/**
 * What it COST, never why the mechanism could not mark a control. The second half is the reassuring one: a reader
 * told a save failed wants to know whether the work is gone. Exported so the wording is pinned rather than retyped.
 */
export const UNHANDLED_FIELD_REFUSAL = buildRefusal({
  // Never `Ablehnung` — that is the triage's decline, and this fires on that page too. Never a reload: it would
  // discard the entries this sentence has just promised are intact.
  reason: "Nichts wurde gespeichert, aber Deine Eingaben stehen unverändert im Formular",
  repair: "Versuche es noch einmal",
});

const reportUnhandledFieldError = (): void => {
  appToast.danger("Speichern fehlgeschlagen", { description: UNHANDLED_FIELD_REFUSAL });
};

/** Focus order inside a react-aria field root, once the named element has refused focus itself. */
const FOCUSABLE = "input:not([type=hidden]), select, textarea, button:not([tabindex='-1']), [tabindex='0']";

/**
 * The named element is not always one a caret can reach: a `NumberField` carries `name` on a hidden input,
 * and a `display: none` proxy takes no focus. `focus()` on either is a silent no-op, so success is ASKED for.
 */
function takesFocus(control: HTMLElement): boolean {
  control.focus();
  if (control.ownerDocument.activeElement === control) return true;

  const root = control.closest("[data-rac][data-slot]");

  for (const candidate of root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []) {
    candidate.focus();
    if (candidate.ownerDocument.activeElement === candidate) return true;
  }

  return false;
}

/**
 * Moves focus to the first refused field in DOCUMENT order, and answers whether any control rendered the path.
 * Not `reportValidity()`: it speaks for native validation alone, which `aria` removes.
 */
export function focusFirstRefusal(form: HTMLFormElement, fieldErrors: FieldErrors): boolean {
  let rendered = false;

  for (const control of Array.from(form.elements)) {
    const name = control.getAttribute("name");
    // `hasOwn` and not `in`: `in` walks the prototype, so a field named `constructor` would match an empty map.
    if (name === null || !Object.hasOwn(fieldErrors, name)) continue;

    // Kept separate from the focus attempt: a field whose only control cannot take focus still SHOWS the
    // message, so the toast below must not claim nothing renders the path.
    rendered = true;
    if (control instanceof HTMLElement && takesFocus(control)) return true;
  }

  return rendered;
}

/**
 * Whether a refusal has to be announced rather than shown. Pulled out of the effect so it can be exercised:
 * inverted, the toast fires on every refusal a field DID render and is silent on the one case it exists for.
 */
export function needsUnhandledReport(fieldErrors: FieldErrors, rendered: boolean): boolean {
  return Object.keys(fieldErrors).length > 0 && !rendered;
}

/**
 * Focus has to move from an effect rather than from the submit handler: the message is rendered by the render this
 * state change causes, and focusing a field before it can announce one leaves a screen reader with nothing to read.
 */
export function useServerFieldErrors() {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (form === null || Object.keys(fieldErrors).length === 0) return;

    if (needsUnhandledReport(fieldErrors, focusFirstRefusal(form, fieldErrors))) reportUnhandledFieldError();
  }, [fieldErrors]);

  return { fieldErrors, setFieldErrors, formRef };
}

/** Whether a failed action result carried anything a field could display. */
export function hasFieldErrors(fieldErrors: FieldErrors | undefined): fieldErrors is FieldErrors {
  return !!fieldErrors && Object.keys(fieldErrors).length > 0;
}
