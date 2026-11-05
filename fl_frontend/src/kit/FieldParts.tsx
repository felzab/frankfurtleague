"use client";

import { useContext } from "react";

import { FieldError, FieldErrorContext } from "react-aria-components/FieldError";
import { Label } from "react-aria-components/Label";
import { Text } from "react-aria-components/Text";

import { COPY, textOf } from "@/core/copy";

import { fieldLabel, messageLine, requiredMark, statusLine } from "./fieldStyles";

import type { Copy, Words } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { ValidationResult } from "react-aria-components/FieldError";
import type { FormStatus } from "./useFormAction";

/**
 * One answer of a fixed choice, a radio group's, a segmented control's or a toggle box's: the catalogue's word or phrase,
 * or a record's own, such as a club's name.
 */
export type Choice = { id: string; label: Words };

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
 * hears the field's required state instead.
 */
export function RequiredMark({ isRequired }: { isRequired: boolean }) {
  return (
    isRequired && (
      <span
        aria-hidden
        className={requiredMark()}>
        {" *"}
      </span>
    )
  );
}

/**
 * The label above a field, an asterisk after it where a value is required: the catalogue's words, or a wording of its
 * own such as a consent's question, which stands as it was shown.
 */
export function FieldLabel({ label, isRequired }: { label: Words; isRequired: boolean }) {
  return (
    <Label className={fieldLabel()}>
      {textOf(label)}
      <RequiredMark isRequired={isRequired} />
    </Label>
  );
}

/**
 * A form's status line at its acts: a refusal, a done save, or the editor's count of unsaved fields. An outcome
 * is announced politely, from a live region standing from the first render, so it answers the press that sent
 * the form; the running count stays outside the region, since it would speak on every edit that changes it.
 */
export function StatusLine({ status, placement }: { status: FormStatus; placement: "row" | "column" }) {
  const tone = status?.tone ?? "none";
  return (
    <p className={statusLine({ placement, tone })}>
      <span role="status">{tone === "changes" ? null : status?.text}</span>
      {tone === "changes" && status?.text}
    </p>
  );
}

/**
 * The line under a field, always there: the error once the value is committed or the form submitted,
 * else a change's consequence, else the description, else empty. `data-kit-message` names it to a `FieldPair`,
 * which lets a short field's line run on past the field into the room beside it.
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
  if (consequence !== undefined) {
    return (
      <Text
        slot="description"
        data-kit-message
        className={messageLine({ tone: "consequence" })}>
        {consequence}
      </Text>
    );
  }
  if (description !== undefined) {
    return (
      <Text
        slot="description"
        data-kit-message
        className={messageLine({ tone: "description" })}>
        {description}
      </Text>
    );
  }
  // An empty line holds the place, describing nothing.
  return (
    <div
      data-kit-message
      className={messageLine({ tone: "description" })}
    />
  );
}
