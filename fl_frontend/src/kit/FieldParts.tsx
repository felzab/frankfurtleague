"use client";

import { useContext } from "react";

import { FieldError, FieldErrorContext } from "react-aria-components/FieldError";
import { Label } from "react-aria-components/Label";
import { Text } from "react-aria-components/Text";

import { COPY, textOf } from "@/core/copy";

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
  if (
    (validationDetails.typeMismatch || validationDetails.patternMismatch || validationDetails.badInput) &&
    constraints.example !== undefined
  ) {
    return field.format(constraints.example);
  }
  return validationDetails.customError ? validationErrors[0] : COPY.shared.failure.unexpected;
}

/**
 * The asterisk after a required field's label, a checkbox's included. Hidden from assistive technology, which
 * hears the field's required state instead. A closed form draws none, since a value nobody can change asks nothing
 * of the reader.
 */
export function RequiredMark({ isRequired }: { isRequired: boolean }) {
  const isClosed = useContext(FormClosed);
  return (
    isRequired &&
    !isClosed && (
      <span
        aria-hidden
        className={requiredMark()}>
        {" *"}
      </span>
    )
  );
}

/**
 * A field's disabled state and whether its label carries the lock mark. A field `isLocked` is one its record holds
 * fixed, such as a season's points once it has begun: disabled, and marked at its label, so what stands locked is
 * seen at the field while the editor's lock line says why. A closed form disables every field and marks none, since its
 * one reason covers them all and a mark on each would single out nothing.
 */
export function useFieldLock(isDisabled: boolean, isLocked: boolean): { isDisabled: boolean; isMarked: boolean } {
  const isClosed = useContext(FormClosed);
  return { isDisabled: isClosed || isDisabled || isLocked, isMarked: isLocked && !isClosed };
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
 * fields. With nothing to say it is not drawn, so it takes no room.
 */
export function StatusLine({ status, placement }: { status: FormStatus; placement: "row" | "column" }) {
  return status !== null && <p className={statusLine({ placement, tone: status.tone })}>{status.text}</p>;
}

/**
 * The line under a field: the error once the value is committed or the form submitted, else a change's consequence,
 * else the description, else nothing seen, so a field with nothing to say ends at its frame. `data-kit-message`
 * names it to the layouts that place a field's line apart from its frame, each ending it under its field and letting it
 * run on past a short field's edge: a label-left row's (`FieldRows`) and the score's (`ScoreRows`).
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

  if (validation?.isInvalid) {
    return (
      <FieldError
        data-kit-message
        className={messageLine({ tone: "error" })}>
        {(result) => fieldMessage(result, constraints)}
      </FieldError>
    );
  }
  const words = consequence ?? description;
  return (
    words !== undefined && (
      <Text
        slot="description"
        data-kit-message
        className={messageLine({ tone: consequence === undefined ? "description" : "consequence" })}>
        {words}
      </Text>
    )
  );
}
