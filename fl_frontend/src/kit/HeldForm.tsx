"use client";

import { useRef } from "react";

import { Form } from "react-aria-components/Form";
import { useObjectRef } from "react-aria/useObjectRef";

import type { ComponentProps, SyntheticEvent } from "react";

/** React Aria's `Form` types neither a capture handler nor `noValidate`, and hands the DOM what it is spread. */
const FORM_ATTRIBUTES = { noValidate: true, onResetCapture: (event: SyntheticEvent<HTMLFormElement>) => event.preventDefault() };

/**
 * A server-drawn form, handing `onSend` the fields as the press left them, unless `isBusy`: a busy submit button takes
 * no press, but Enter in a lone field submits a form all the same, and a second send mid-flight would act twice. A
 * hydrated press stays on `onSubmit`, whose `preventDefault` keeps it out of `action`.
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
  ...form
}: Omit<ComponentProps<typeof Form>, "action" | "onSubmit"> & {
  /** The form's send is on its way, or its act is closed: a press sends nothing. Required, so no form forgets it. */
  isBusy: boolean;
  onSend: (formData: FormData) => void;
}) {
  const element = useObjectRef(ref);
  const isHeld = useRef(false);
  return (
    <Form
      {...form}
      {...FORM_ATTRIBUTES}
      ref={element}
      action={() => {
        if (isHeld.current) return;
        isHeld.current = true;
        element.current?.requestSubmit();
      }}
      onSubmit={(event) => {
        event.preventDefault();
        if (!isBusy && event.currentTarget.reportValidity()) onSend(new FormData(event.currentTarget));
      }}
    />
  );
}
