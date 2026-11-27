"use client";

import { createContext, useContext, useLayoutEffect, useRef } from "react";

import { Form } from "react-aria-components/Form";
import { useObjectRef } from "react-aria/useObjectRef";

import type { Copy } from "@/core/copy";
import type { ComponentProps, SyntheticEvent } from "react";

/** React Aria's `Form` types neither a capture handler nor `noValidate`, and hands the DOM what it is spread. */
const FORM_ATTRIBUTES = { noValidate: true, onResetCapture: (event: SyntheticEvent<HTMLFormElement>) => event.preventDefault() };

/** The server's faults by the box each stands on, its `name`. */
export type FieldFaults = Readonly<Record<string, Copy>>;

const Faults = createContext<FieldFaults | undefined>(undefined);

/**
 * The server's fault on a part of the form that holds no box of its own, such as a list's own refusal under its rows
 * (`RecordRows`), by the name a box would carry: the same faults the form hands React Aria, so it stands and goes with
 * them.
 */
export function useFieldFault(name: string): Copy | undefined {
  return useContext(Faults)?.[name];
}

/**
 * The one judged form of the site: every form a person sends is this one, a dialog's included. Both passes end alike.
 * The browser's pass judges every box on the press and shows every fault at once, the send held back while one stands
 * (`onBlock`). The server's pass answers `fieldErrors`, each fault by its box's `name`, which React Aria's
 * `validationErrors` puts on the box (`useFormValidationState`). Either way the focus goes to the first faulted box:
 * once an answer's faults have committed, the form asks the browser's report itself, whose `invalid` event React
 * Aria's every field answers by focusing the first invalid one through the field's own `focus` (`useFormValidation`),
 * a date's segments, a select's button and a choice group included. That report stands for no press, so it tells
 * `onBlock` nothing: the status line says what the answer says.
 *
 * A press hands `onSend` the fields as it left them, unless `isBusy`: a busy submit button takes no press, but Enter in
 * a lone field submits a form all the same, and a second send mid-flight would act twice. A hydrated press stays on
 * `onSubmit`, whose `preventDefault` keeps it out of `action`, and whose `stopPropagation` keeps it from a form around
 * this one, since React's submit event bubbles through a portal, a dialog's opened from an editor's section among them.
 *
 * A press before hydration is the browser's own unless held, a GET carrying every field in the URL. The fields wait
 * until then (`useFieldWait`), but the send does not. A function `action` has React's server output keep the press and
 * replay it once the form hydrates. React takes that function at the hydrating commit, so it knows no send a press
 * right after the commit began, and only presses again, onto the current render's `onSubmit`. React replays every
 * press a slow page gathered in one task, ahead of any render, where a busy guard knows none of them, so only the first
 * presses again. React resets a form after such a press, which would take each field back to its first value, so the
 * reset is refused in the capture phase, ahead of React Aria's listener on the form, which heeds it.
 *
 * The browser's own check would stop a press before hydration ahead of all this, and in silence on a control it cannot
 * show, a date's hidden input and every field still waiting among them, since a waiting field takes no focus, so the
 * form is `noValidate` and `onSubmit` asks for that check itself: a held press and a live one meet it on one path, and
 * each field's listener shows what it refuses. React Aria's `aria` behaviour is no answer, since it judges a field as it
 * is typed.
 */
export function HeldForm({
  ref,
  isBusy,
  onSend,
  fieldErrors,
  onBlock,
  children,
  ...form
}: Omit<ComponentProps<typeof Form>, "action" | "onSubmit" | "validationErrors" | "onInvalid"> & {
  /** The form's send is on its way, or its act is closed: a press sends nothing. Required, so no form forgets it. */
  isBusy: boolean;
  onSend: (formData: FormData) => void;
  /** The last answer's faults, while they stand. Required, so no form leaves the server's faults off its boxes. */
  fieldErrors: FieldFaults | undefined;
  /** The browser's pass held the press back, which a status line points at the boxes for. */
  onBlock?: () => void;
}) {
  const element = useObjectRef(ref);
  const isHeld = useRef(false);
  const isReporting = useRef(false);
  // A parent's layout effect runs after its children's, so each field has set its fault as its validity by now.
  useLayoutEffect(() => {
    if (fieldErrors === undefined || Object.keys(fieldErrors).length === 0) return;
    isReporting.current = true;
    try {
      element.current?.reportValidity();
    } finally {
      isReporting.current = false;
    }
  }, [fieldErrors, element]);
  return (
    <Form
      {...form}
      {...FORM_ATTRIBUTES}
      ref={element}
      validationErrors={fieldErrors}
      onInvalid={() => {
        if (!isReporting.current) onBlock?.();
      }}
      action={() => {
        if (isHeld.current) return;
        isHeld.current = true;
        element.current?.requestSubmit();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!isBusy && event.currentTarget.reportValidity()) onSend(new FormData(event.currentTarget));
      }}>
      <Faults value={fieldErrors}>{children}</Faults>
    </Form>
  );
}
