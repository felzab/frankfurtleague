"use client";

import { useContext } from "react";

import { FieldError, FieldErrorContext } from "react-aria-components/FieldError";
import { Label } from "react-aria-components/Label";
import { Text } from "react-aria-components/Text";

import { COPY } from "@/core/copy";

import { fieldLabel, messageLine, requiredMark, statusLine } from "./fieldStyles";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { ValidationResult } from "react-aria-components/FieldError";
import type { FormStatus } from "./useFormAction";

/** One answer of a fixed choice, a word or a phrase: a radio group's, a segmented control's or a toggle box's. */
export type Choice = { id: string; label: Copy };

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
 * the client. A message the server or the form sent stands as it came.
 */
function fieldMessage({ validationDetails, validationErrors }: ValidationResult, constraints: Constraints) {
  const { feld } = COPY.shared;
  if (validationDetails.valueMissing) return feld.pflichtfeld;
  if (validationDetails.tooLong && constraints.maxLength !== undefined) return feld.hoechstensZeichen(constraints.maxLength);
  if (validationDetails.tooShort && constraints.minLength !== undefined) return feld.mindestensZeichen(constraints.minLength);
  if (validationDetails.rangeUnderflow && constraints.earliest !== undefined) return feld.fruehestens(constraints.earliest);
  if (validationDetails.rangeOverflow && constraints.latest !== undefined) return feld.spaetestens(constraints.latest);
  if (
    (validationDetails.typeMismatch || validationDetails.patternMismatch || validationDetails.badInput) &&
    constraints.example !== undefined
  ) {
    return feld.format(constraints.example);
  }
  return validationErrors[0];
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

/** The label above a field, an asterisk after it where a value is required. */
export function FieldLabel({ label, isRequired }: { label: Copy; isRequired: boolean }) {
  return (
    <Label className={fieldLabel()}>
      {label}
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
 * else a change's consequence, else the description, else empty.
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
    return <FieldError className={messageLine({ tone: "error" })}>{(result) => fieldMessage(result, constraints)}</FieldError>;
  }
  if (consequence !== undefined) {
    return (
      <Text
        slot="description"
        className={messageLine({ tone: "consequence" })}>
        {consequence}
      </Text>
    );
  }
  if (description !== undefined) {
    return (
      <Text
        slot="description"
        className={messageLine({ tone: "description" })}>
        {description}
      </Text>
    );
  }
  // An empty line holds the place, describing nothing.
  return <div className={messageLine({ tone: "description" })} />;
}
