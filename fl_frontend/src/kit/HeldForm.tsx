"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { Form } from "react-aria-components/Form";
import { useObjectRef } from "react-aria/useObjectRef";
import { flushSync } from "react-dom";

import type { BoxRule, BoxRules } from "@/core/boxRules";
import type { Copy } from "@/core/copy";
import type { ComponentProps, SyntheticEvent } from "react";

/** React Aria's `Form` types neither a capture handler nor `noValidate`, and hands the DOM what it is spread. */
const FORM_ATTRIBUTES = { noValidate: true, onResetCapture: (event: SyntheticEvent<HTMLFormElement>) => event.preventDefault() };

/** The server's faults by the box each stands on, its `name`. */
export type FieldFaults = Readonly<Record<string, Copy>>;

const Faults = createContext<FieldFaults | undefined>(undefined);

/**
 * The server's faults standing on the form, for a part that holds no box of its own, such as a list's own refusal under
 * its rows (`RecordRows`) or a line-up's refused pupil, each by the name a box would carry: the same faults the form
 * hands React Aria, so they stand and go with them.
 */
export function useFieldFaults(): FieldFaults | undefined {
  return useContext(Faults);
}

/** What the form holds each box to: its lane's rules, and the boxes the form's own draft needs filled beside them. */
type Held = { readonly rules: BoxRules; readonly required: ReadonlySet<string> };

const Rules = createContext<Held>({ rules: {}, required: new Set() });

/** A row's index in a box's name, as `scorers.2.minute` holds one, which its lane's rules key as every row's `*`. */
const ROW = /(?<=^|\.)\d+(?=\.|$)/gu;

/**
 * The rule the browser's pass holds a box to, by the `name` it posts under: its lane's, a list's row's by the rule every
 * row takes, required where the form's own draft needs it filled too. Nothing outside a form, and nothing for a box
 * posting under no name.
 */
export function useBoxRule(name: string | undefined): BoxRule {
  const { rules, required } = useContext(Rules);
  if (name === undefined) return {};
  const rule = rules[name] ?? rules[name.replace(ROW, "*")] ?? {};
  return required.has(name) ? { ...rule, required: true } : rule;
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const isControl = (element: Element): element is Control =>
  element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement;

/**
 * The controls judging a box the answer names, whose `invalid` event React Aria's field answers: the box a kit field
 * posts under, or, where that box is a hidden input no browser judges, as a record picker posts its record's id while
 * its typed text holds the fault, the controls of the field around it that the browser does judge.
 */
const judgedFor = (faults: FieldFaults, control: Element): readonly Control[] => {
  if (!isControl(control) || !Object.hasOwn(faults, control.name)) return [];
  if (control.willValidate) return [control];
  return [...(control.parentElement?.querySelectorAll("input, select, textarea") ?? [])].filter(
    (judged): judged is Control => isControl(judged) && judged.willValidate,
  );
};

/**
 * The one judged form of the site: every form a person sends is this one, a dialog's included. Both passes end alike.
 * The browser's pass judges every box on the press and shows every fault at once, the send held back while one stands
 * (`onBlock`). The server's pass answers `fieldErrors`, each fault by its box's `name`, which React Aria's
 * `validationErrors` puts on the box (`useFormValidationState`) until that box changes or the next press, which ends
 * every fault still standing: the server judged what the last press sent, and judges the next anew.
 *
 * Either way the focus goes to the first faulted box: once an answer's faults have committed, the form checks each box
 * the answer names, whose `invalid` event React Aria's field answers by focusing the form's first invalid box through
 * the field's own `focus` (`useFormValidation`), a date's segments, a select's button, a record picker's text and a
 * choice group included (`judgedFor`); where no named box is invalid, as a list's own refusal names none, the focus
 * stays on the press, and the part shows its fault. That check stands for no press, so it tells `onBlock` nothing: the
 * status line says what the answer says. It reaches no other box, since React Aria commits the fault of every box an
 * `invalid` event reaches: a box the person changed while the send was on its way is judged once they commit it, and
 * one they left invalid ahead of the named boxes keeps the focus, as React Aria focuses the form's first invalid box
 * alone.
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
  rules,
  required,
  onBlock,
  children,
  ...form
}: Omit<ComponentProps<typeof Form>, "action" | "onSubmit" | "validationErrors" | "validationBehavior" | "onInvalid"> & {
  /** The form's send is on its way, or its act is closed: a press sends nothing. Required, so no form forgets it. */
  isBusy: boolean;
  onSend: (formData: FormData) => void;
  /** The last answer's faults, which a press ends. Required, so no form leaves the server's faults off its boxes. */
  fieldErrors: FieldFaults | undefined;
  /**
   * What the browser's pass holds each box to, its lane's own rules (`core/action.ts :: boxRulesOf`), by the name each
   * box posts under. Required, so no form judges a box by rules of its own.
   */
  rules: BoxRules;
  /** The boxes the form's own draft needs filled beside its lane's rules, such as an editor's, by their names. */
  required?: readonly string[];
  /** The browser's pass held the press back, which a status line points at the boxes for. */
  onBlock?: () => void;
}) {
  const element = useObjectRef(ref);
  // One object while the rules and the needed boxes stand, so a form's own render renders no field again for them.
  const needed = required?.join(" ") ?? "";
  const held = useMemo<Held>(() => ({ rules, required: new Set(needed.split(" ").filter(Boolean)) }), [rules, needed]);
  // The answer a press has ended, whose faults stand on no box whatever the form's holder still hands down.
  const [ended, setEnded] = useState<FieldFaults>();
  const standing = fieldErrors === ended ? undefined : fieldErrors;
  const isHeld = useRef(false);
  const isReporting = useRef(false);
  // The answer last reported. A ref outlives an `Activity`, which re-creates this effect each time it shows the form
  // again, as Next shows a page the person comes back to: an answer already reported never takes the focus again.
  const reported = useRef<FieldFaults | undefined>(undefined);
  // A parent's effects run after its children's: each field has set its fault as its validity in a layout effect, and
  // attached its `invalid` listener in a passive one, which a form opening on its faults, as a reopened card does, has
  // only once its own passive effects run.
  useEffect(() => {
    const form = element.current;
    if (form === null || fieldErrors === undefined || fieldErrors === reported.current) return;
    reported.current = fieldErrors;
    isReporting.current = true;
    try {
      for (const control of [...form.elements].flatMap((named) => judgedFor(fieldErrors, named))) control.checkValidity();
    } finally {
      isReporting.current = false;
    }
  }, [fieldErrors, element]);
  return (
    <Form
      {...form}
      {...FORM_ATTRIBUTES}
      ref={element}
      validationErrors={standing}
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
        if (isBusy) return;
        const pressed = event.currentTarget;
        // React Aria makes a served fault the browser's own rule on its box until that box changes, so one left on a
        // box the person need not change, a pair rule's other box, would hold back every press with nothing sent. The
        // faults go here, in a render the browser's pass waits for, and the server judges what the press sends.
        if (standing !== undefined) flushSync(() => setEnded(standing));
        if (pressed.reportValidity()) onSend(new FormData(pressed));
      }}>
      <Rules value={held}>
        <Faults value={standing}>{children}</Faults>
      </Rules>
    </Form>
  );
}
