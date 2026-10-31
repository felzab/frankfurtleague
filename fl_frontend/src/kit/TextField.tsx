"use client";

import { useContext, useId } from "react";

import { FieldErrorContext } from "react-aria-components/FieldError";
import { TextField as AriaTextField, Input, TextArea } from "react-aria-components/TextField";

import { COPY } from "@/core/copy";

import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldFrame, fieldRoot, fieldUnit } from "./fieldStyles";

import type { Copy } from "@/core/copy";
import type { Constraints } from "./FieldParts";

type Shared = {
  label: Copy;
  isRequired?: boolean;
  isDisabled?: boolean;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
  minLength?: number;
};

/**
 * The message line under the field: always there, so a message appearing or going moves nothing; or, on the
 * sign-in's one-field view whose two acts stand right under the field, there only with the error, so the field
 * and its acts read as one block and move down together. A line that is not always there describes nothing.
 */
type Line =
  | {
      line?: "always";
      description?: Copy;
      /** What changing this value sets off beyond the record, said in the warn colour in the message line. */
      consequence?: Copy;
    }
  | { line: "withError"; description?: never; consequence?: never };

/**
 * What a text or digits field asks of the person about themselves, as the HTML autofill token the browser
 * fills from what it holds: only where the field asks for the person's own name, school or address.
 */
type Autofill = "name" | "given-name" | "family-name" | "organization" | "street-address" | "postal-code" | "address-level2";

/**
 * What an address field is filled as: the person's address, or, where the address signs in, the account's
 * name, under which a password manager files what it keeps for the site.
 */
type EmailAutofill = "email" | "username";

/**
 * A single line at its width, its keyboard set by `kind`; a URL names the example its message shows. A score is
 * `C2`; a postcode, whole euros or a house number `C5`; a name, an address, a phone number or a URL the column.
 */
type SingleLine = {
  width: "C2" | "C5" | "W3";
} & (
  | { kind: "text"; autofill?: Autofill; example?: never; unit?: never }
  /** `unit` stands after the field, outside it, as „€“ after a price. */
  | { kind: "digits"; autofill?: Autofill; example?: never; unit?: Copy }
  | { kind: "email"; autofill?: EmailAutofill; example?: never; unit?: never }
  | { kind: "tel" | "search"; autofill?: never; example?: never; unit?: never }
  | { kind: "url"; autofill?: never; example: Copy; unit?: never }
);

/** A paragraph: the column's width at four lines. */
type Paragraph = { width: "W4"; kind: "text"; autofill?: never; example?: never; unit?: never };

export type TextFieldProps = Shared & Line & (SingleLine | Paragraph);

/**
 * What each kind sets on the input: its type, the keyboard a phone opens, what the browser offers to fill.
 * A text or digits field is filled only where its `autofill` names what it asks for; an address field's
 * `autofill` replaces its own.
 */
const KINDS = {
  text: { type: "text", inputMode: undefined, autoComplete: undefined, pattern: undefined },
  // A count or a figure: a plain field opening the digits keyboard, with no stepper, taking digits alone, so
  // anything else reads „Format: …“ at the send rather than reaching the server.
  digits: { type: "text", inputMode: "numeric", autoComplete: undefined, pattern: "[0-9]*" },
  email: { type: "email", inputMode: undefined, autoComplete: "email", pattern: undefined },
  tel: { type: "tel", inputMode: undefined, autoComplete: "tel", pattern: undefined },
  url: { type: "url", inputMode: undefined, autoComplete: "url", pattern: undefined },
  search: { type: "search", inputMode: undefined, autoComplete: undefined, pattern: undefined },
} as const;

/** The example a malformed value is shown, by kind; a URL names its own. */
const EXAMPLE = { email: COPY.shared.feld.beispielAdresse, digits: COPY.shared.feld.beispielZiffern } as const;

/** The line only once the field is invalid: it reads the field's validation, which the field provides to its children. */
function LineWithError({ constraints }: { constraints: Constraints }) {
  const validation = useContext(FieldErrorContext);
  return validation?.isInvalid === true ? <MessageLine constraints={constraints} /> : null;
}

/**
 * Type text or a number: the label above, an asterisk after it on a required field, the field at its
 * width class, then its message line as `line` sets it. An error first shows once the value is
 * committed or the form submitted, never while typing.
 */
export function TextField(props: TextFieldProps) {
  const { label, description, consequence, isRequired = false, isDisabled = false, width, kind, maxLength, minLength } = props;
  const keys = KINDS[kind];
  const constraints: Constraints = {
    maxLength,
    minLength,
    example: props.kind === "url" ? props.example : kind === "email" || kind === "digits" ? EXAMPLE[kind] : undefined,
  };
  const frame = fieldFrame({ width, inset: "full", figures: kind === "digits" });
  const field =
    width === "W4" ? (
      <TextArea
        data-kit-focus="field"
        rows={4}
        className={frame}
      />
    ) : (
      <Input
        data-kit-focus="field"
        className={frame}
      />
    );
  const unit = fieldUnit();
  const unitId = useId();

  return (
    <AriaTextField
      className={fieldRoot()}
      name={props.name}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={props.onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      maxLength={maxLength}
      minLength={minLength}
      type={keys.type}
      inputMode={keys.inputMode}
      pattern={keys.pattern}
      autoComplete={props.autofill ?? keys.autoComplete}
      aria-describedby={props.unit === undefined ? undefined : unitId}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
      />
      {props.unit === undefined ? (
        field
      ) : (
        <span className={unit.row()}>
          {field}
          {/* Read once, as the input's description, and hidden where it stands, so browsing past the field does
              not read it a second time: the label names what the figure counts, the unit what it counts in. */}
          <span
            id={unitId}
            aria-hidden
            className={unit.unit()}>
            {props.unit}
          </span>
        </span>
      )}
      {props.line === "withError" ? (
        <LineWithError constraints={constraints} />
      ) : (
        <MessageLine
          description={description}
          consequence={consequence}
          constraints={constraints}
        />
      )}
    </AriaTextField>
  );
}
