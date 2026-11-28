"use client";

import { useContext } from "react";

import { FieldError, FieldErrorContext } from "react-aria-components/FieldError";
import { Label } from "react-aria-components/Label";
import { Text } from "react-aria-components/Text";
import { useIsSSR } from "react-aria/SSRProvider";

import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";

import { fieldLabel, lockMark, messageLine, requiredMark, statusLine } from "./fieldStyles";
import { FormClosed } from "./formClosed";
import { Icon } from "./Icon";

import type { Copy, Words } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { ValidationResult } from "react-aria-components/FieldError";
import type { FormStatus } from "./useFormAction";

/**
 * One answer of a fixed choice, a radio group's, a segmented control's or a toggle box's: the catalogue's word or phrase,
 * or a record's own, such as a club's name. `spoken` is its name to a screen reader where `label` draws a short form,
 * such as a club's Kürzel standing for its name, as a chip's `spoken` is.
 */
export type Choice = { id: string; label: Words; spoken?: Words };

/** What a field's message needs to name the rule its value broke. */
export type Constraints = {
  maxLength?: number;
  minLength?: number;
  /** The example a malformed value is shown, as in „Format: name@example.com“. */
  example?: Copy;
  /** A date's bounds, which an earlier or a later day is shown. */
  earliest?: CalendarDay;
  latest?: CalendarDay;
};

/**
 * The browser's validity flags as the fixed field messages, so no browser wording and no schema reaches
 * the client. A message the server or the form sent stands as it came: React Aria marks every message it did not
 * read off the browser's own check, a form's `validationErrors` and a `validate` function's alike, `customError`
 * (`useFormValidationState`). A native flag no constraint words carries the browser's or React Aria's own
 * wording, which no catalogue holds, so it answers the shared failure line.
 */
function fieldMessage({ validationDetails, validationErrors }: ValidationResult, constraints: Constraints) {
  const { field } = COPY.shared;
  if (validationDetails.valueMissing) return field.required;
  if (validationDetails.tooLong && constraints.maxLength !== undefined) return field.maxChars(constraints.maxLength);
  if (validationDetails.tooShort && constraints.minLength !== undefined) return field.minChars(constraints.minLength);
  if (validationDetails.rangeUnderflow && constraints.earliest !== undefined) return field.earliest(constraints.earliest);
  if (validationDetails.rangeOverflow && constraints.latest !== undefined) return field.latest(constraints.latest);
  // No kit field sets the `pattern` attribute, so no `patternMismatch` arises: a pattern is the field's `validate`.
  if ((validationDetails.typeMismatch || validationDetails.badInput) && constraints.example !== undefined) {
    return field.format(constraints.example);
  }
  return validationDetails.customError ? validationErrors[0] : COPY.shared.failure.unexpected;
}

/**
 * Whether a field asks for a value, to the eye and to assistive technology alike: never in a closed form or on a
 * locked field, since a value nobody can change asks nothing of the reader. React Aria sets `required` or
 * `aria-required` from `isRequired` whatever `isReadOnly` says, so a field hands it this answer, never its own prop.
 */
function asksForValue(isRequired: boolean, isClosed: boolean, isLocked: boolean): boolean {
  return isRequired && !isClosed && !isLocked;
}

/**
 * The asterisk after a required field's label, a score column's head included. Hidden from assistive technology,
 * which hears the field's required state instead; drawn only where the field asks for a value (`asksForValue`).
 */
export function RequiredMark({ isRequired }: { isRequired: boolean }) {
  return (
    asksForValue(isRequired, useContext(FormClosed), false) && (
      <span
        aria-hidden
        className={requiredMark()}>
        {" *"}
      </span>
    )
  );
}

/**
 * A field's read-only state, its required state and whether its label carries the lock mark, the one place a lock or a
 * closed form decides them. A field `isLocked` is one its record holds fixed, such as a season's points once it has
 * begun: read-only, and marked at its label, so what stands locked is seen at the field while the editor's lock line
 * says why. A closed form makes every field read-only and marks none, since its one reason covers them all and a mark
 * on each would single out nothing. Read-only rather than disabled, since the value is the record's own: React Aria's
 * `isReadOnly` keeps the field in the keys' order and its value readable, where a disabled field is passed over.
 * A field hands React Aria its own `isDisabled`, for a value unavailable until something else is given, which no lock
 * lifts. Neither a lock nor a closed form asks for a value (`asksForValue`), so `isRequired` is what the field hands
 * React Aria and its label.
 */
export function useFieldLock(isLocked: boolean, isRequired = false): { isReadOnly: boolean; isMarked: boolean; isRequired: boolean } {
  const isClosed = useContext(FormClosed);
  return {
    isReadOnly: isClosed || isLocked,
    isMarked: isLocked && !isClosed,
    isRequired: asksForValue(isRequired, isClosed, isLocked),
  };
}

/**
 * Whether a field still waits for the page's code, which every field a person types into or toggles takes at its root
 * as its `inert`. Until the page hydrates, a server-drawn field would take a person's typing or press with no code to
 * hear it: React leaves what the browser shows while hydrating, and its next render writes the field's own state over
 * it, and a digit typed into a date's segment fails hydration outright. So the field takes neither focus nor input
 * until then, painting as the live one does and posting its value with its form. `disabled` would drop it from what
 * the form posts, and `readOnly` leaves a caret on some browsers and holds no box or radio. A press of the form's send
 * in that time is `HeldForm`'s. React Aria answers true on the server and through hydration alone, so a field first
 * drawn in the browser never waits.
 */
export function useFieldWait(): boolean {
  return useIsSSR();
}

/** The lock mark after a locked control's label, a field's or a switch's alike, `useFieldLock`'s `isMarked`. */
export function LockMark() {
  return (
    <span className={lockMark()}>
      <Icon
        glyph="locked"
        size={16}
      />
    </span>
  );
}

/**
 * The label above a field, an asterisk after it where a value is required and the form is open: the catalogue's words,
 * or a wording of its own such as a consent's question, which stands as it was shown. A locked field's label takes the
 * lock mark in the asterisk's place, since a value nobody can change asks nothing of the reader; the field is named by
 * its words alone.
 */
export function FieldLabel({ label, isRequired, isLocked = false }: { label: Words; isRequired: boolean; isLocked?: boolean }) {
  return (
    <Label className={fieldLabel()}>
      {textOf(label)}
      {isLocked ? <LockMark /> : <RequiredMark isRequired={isRequired} />}
    </Label>
  );
}

/**
 * A form's status line at its acts: a refusal, a done save, why its act cannot run, or the editor's count of unsaved
 * fields. The outcome stands in a status region a screen reader speaks, which is there from the first render, empty,
 * since a region drawn together with its first words is not reliably heard; while empty it stands out of the flow, as
 * the visually hidden do, so it takes no room and no gap beside the acts. The count of unsaved fields stands outside
 * it, as it changes on every keystroke.
 */
export function StatusLine({ status, placement }: { status: FormStatus; placement: "row" | "column" }) {
  const outcome = status?.tone === "changes" ? null : status;
  return (
    <>
      {status?.tone === "changes" && <p className={statusLine({ placement, tone: "changes" })}>{status.text}</p>}
      <p
        role="status"
        className={statusLine({ placement, tone: outcome?.tone, class: "empty:sr-only" })}>
        {outcome?.text}
      </p>
    </>
  );
}

/**
 * The line under a field: the error once the value is committed or the form submitted, else a change's consequence,
 * else the description, else nothing seen, so a field with nothing to say ends at its frame. A closed form draws no
 * consequence, since nothing is changed there to cause one, and keeps the description saying what the field is.
 * `data-kit-message` names it to the layouts that place a field's line apart from its frame, each ending it under its
 * field and letting it run on past a short field's edge: a label-left row's (`FieldRows`) and the score's (`ScoreRows`).
 */
export function MessageLine({
  description,
  consequence,
  constraints = {},
}: {
  description?: Copy;
  consequence?: Copy;
  constraints?: Constraints;
}) {
  const validation = useContext(FieldErrorContext);
  const shown = useContext(FormClosed) ? undefined : consequence;

  if (validation?.isInvalid) {
    return (
      <FieldError
        data-kit-message
        className={messageLine({ tone: "danger" })}>
        {(result) => fieldMessage(result, constraints)}
      </FieldError>
    );
  }
  const words = shown ?? description;
  return (
    words !== undefined && (
      <Text
        slot="description"
        data-kit-message
        className={messageLine({ tone: shown === undefined ? "description" : "consequence" })}>
        {words}
      </Text>
    )
  );
}
