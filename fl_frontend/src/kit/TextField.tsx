"use client";

import { TextField as AriaTextField, Input, TextArea } from "react-aria-components/TextField";

import { COPY } from "@/core/copy";

import { FieldLabel, MessageLine } from "./FieldParts";
import { fieldFrame, fieldRoot, fieldUnit } from "./fieldStyles";

import type { Copy } from "@/core/copy";
import type { Constraints } from "./FieldParts";

type Shared = {
  label: Copy;
  description?: Copy;
  /** What changing this value sets off beyond the record, said in the warn colour in the message line. */
  consequence?: Copy;
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
  | { kind: "text"; autofill?: Autofill; beispiel?: never; unit?: never }
  /** `unit` stands after the field, outside it, as „€“ after a price. */
  | { kind: "digits"; autofill?: Autofill; beispiel?: never; unit?: Copy }
  | { kind: "email"; autofill?: EmailAutofill; beispiel?: never; unit?: never }
  | { kind: "tel" | "search"; autofill?: never; beispiel?: never; unit?: never }
  | { kind: "url"; autofill?: never; beispiel: Copy; unit?: never }
);

/** A paragraph: the column's width at four lines. */
type Paragraph = { width: "W4"; kind: "text"; autofill?: never; beispiel?: never; unit?: never };

export type TextFieldProps = Shared & (SingleLine | Paragraph);

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
const BEISPIEL = { email: COPY.shared.feld.beispielAdresse, digits: COPY.shared.feld.beispielZiffern } as const;

/**
 * Type text or a number: the label above, an asterisk after it on a required field, the field at its
 * width class, then the message line that is always there. An error first shows once the value is
 * committed or the form submitted, never while typing.
 */
export function TextField(props: TextFieldProps) {
  const { label, description, consequence, isRequired = false, isDisabled = false, width, kind, maxLength, minLength } = props;
  const keys = KINDS[kind];
  const constraints: Constraints = {
    maxLength,
    minLength,
    beispiel: props.kind === "url" ? props.beispiel : kind === "email" || kind === "digits" ? BEISPIEL[kind] : undefined,
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
      autoComplete={props.autofill ?? keys.autoComplete}>
      <FieldLabel
        label={label}
        isRequired={isRequired}
      />
      {props.unit === undefined ? (
        field
      ) : (
        <span className={unit.row()}>
          {field}
          {/* Hidden from assistive technology, as GOV.UK hides a suffix: the label names what the figure counts. */}
          <span
            aria-hidden
            className={unit.unit()}>
            {props.unit}
          </span>
        </span>
      )}
      <MessageLine
        description={description}
        consequence={consequence}
        constraints={constraints}
      />
    </AriaTextField>
  );
}
