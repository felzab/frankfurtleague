"use client";

import { useId } from "react";

import { TextField as AriaTextField, Input, TextArea } from "react-aria-components/TextField";
import { useIsSSR } from "react-aria/SSRProvider";

import { COPY, textOf } from "@/core/copy";
import { isDeliverableAddress, KONTAKT_EMAIL_MAX_LENGTH } from "@/core/emailAddress";

import { FieldLabel, MessageLine, useFieldLock } from "./FieldParts";
import { fieldFrame, fieldRoot, fieldUnit } from "./fieldStyles";
import { useEarlyEdit } from "./useEarlyEdit";

import type { Copy, Words } from "@/core/copy";
import type { Constraints } from "./FieldParts";

type Shared = {
  /** The catalogue's words, or a record's own, such as a score field named by its club. */
  label: Words;
  isRequired?: boolean;
  isDisabled?: boolean;
  /**
   * Held fixed by its record, such as a season's points once it has begun: disabled, its label marked with the lock
   * (`useFieldLock`), while the editor's lock line says why.
   */
  isLocked?: boolean;
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  maxLength?: number;
  minLength?: number;
  /**
   * Whether the label names the field to a screen reader alone, the place around it naming it on the screen: a
   * section holding this one field, whose title the label is, or a score's column head. A required mark goes with it.
   */
  labelHidden?: boolean;
  /** The line under the field when nothing is wrong: what to type, where the label alone does not say it. */
  description?: Copy;
  /** What changing this value sets off beyond the record, said in the warn colour in the message line. */
  consequence?: Copy;
};

/**
 * What a text or digits field asks of the person about themselves, as the HTML autofill token the browser
 * fills from what it holds: only where the field asks for the person's own name, school or address.
 */
type Autofill = "name" | "given-name" | "family-name" | "organization" | "street-address" | "postal-code" | "address-level2";

/**
 * What an address field is filled as: the person's address; where the address signs in, the account's name, under
 * which a password manager files what it keeps for the site; or nothing, `off`, where an administrator types somebody
 * else's, which would otherwise stay in the browser and be offered to the next form.
 */
type EmailAutofill = "email" | "username" | "off";

/** A single line's keyboard, set by `kind`; a URL and a minute name the example their message shows. */
type Kind =
  | { kind: "text"; autofill?: Autofill; example?: never; pattern?: never }
  | { kind: "digits"; autofill?: Autofill; example?: never; pattern?: never }
  | { kind: "email"; autofill?: EmailAutofill; example?: never; pattern?: never }
  | { kind: "tel"; autofill?: never; example?: never; pattern?: never }
  | { kind: "url"; autofill?: never; example: Copy; pattern?: never }
  /**
   * A played minute, stoppage time after a plus, „90+3“: `pattern` is the write's own for it, which the caller reads
   * off the published contract, a server module the kit cannot import.
   */
  | { kind: "minute"; autofill?: never; example: Copy; pattern: string };

/*
 * A field's width follows from what it holds, so no caller sets one: a value of a known length is short, a paragraph
 * takes its box's whole width, and every other value the one standard width (`fieldFrame`).
 */

/**
 * A value of a known length, as wide as it is: `holds` counts its characters, 2 for a score, a shirt number or a
 * count, 5 for a minute, a price, a postcode or a house number. `unit` stands after the value inside the field, as
 * „€“ after a price.
 */
type Short = { holds: 2 | 5; unit?: Copy } & Kind;

/** A value whose length varies, a name, an address, a phone number or a URL: the one standard width. */
type Standard = { holds?: never; unit?: never } & Kind;

/** A paragraph: its box's whole width at four lines. */
type Paragraph = { kind: "paragraph"; holds?: never; autofill?: never; example?: never; unit?: never; pattern?: never };

export type TextFieldProps = Shared & (Short | Standard | Paragraph);

/**
 * What each kind sets on the input: its type, the keyboard a phone opens, what the browser offers to fill.
 * A text or digits field is filled only where its `autofill` names what it asks for; an address field's
 * `autofill` replaces its own.
 */
const KINDS = {
  text: { type: "text", inputMode: undefined, autoComplete: undefined, pattern: undefined },
  paragraph: { type: "text", inputMode: undefined, autoComplete: undefined, pattern: undefined },
  // A count or a figure: a plain field opening the digits keyboard, with no stepper, taking digits alone, so
  // anything else reads „Format: …“ at the send rather than reaching the server.
  digits: { type: "text", inputMode: "numeric", autoComplete: undefined, pattern: "[0-9]*" },
  // The phone pad, which carries the plus beside the digits where `numeric`'s pad carries none; a plain text field
  // under it, so a keyboard whose pad lacks the plus still types one. The pattern is the caller's.
  minute: { type: "text", inputMode: "tel", autoComplete: undefined, pattern: undefined },
  email: { type: "email", inputMode: undefined, autoComplete: "email", pattern: undefined },
  tel: { type: "tel", inputMode: undefined, autoComplete: "tel", pattern: undefined },
  url: { type: "url", inputMode: undefined, autoComplete: "url", pattern: undefined },
} as const;

/** The example a malformed value is shown, by kind; a URL names its own. */
const EXAMPLE = { email: COPY.shared.field.exampleAddress, digits: COPY.shared.field.exampleDigits } as const;

/**
 * What the browser's own check passes and the server refuses, judged on the press so a slip costs no round trip and,
 * behind the passkey touch, no touch: a required box holding only spaces, which the server trims to nothing, and an
 * address outside the API's rule, such as a host with no dot, which `type=email` takes. Each in the phrase the
 * server's refusal puts on the box. React Aria shows it once the value is committed or the form pressed, as every
 * field message, and the press goes nowhere while it stands. The sign-in library's own rule and every rule reading a
 * record stay the server's.
 */
function judgeOf(kind: TextFieldProps["kind"], isRequired: boolean) {
  return (value: string): Copy | null => {
    const trimmed = value.trim();
    if (trimmed === "") return isRequired && value !== "" ? COPY.shared.field.required : null;
    // Past the ceiling the browser's `maxLength`, or the server's, names the length rather than the shape.
    if (kind === "email" && trimmed.length <= KONTAKT_EMAIL_MAX_LENGTH && !isDeliverableAddress(trimmed)) {
      return COPY.shared.field.format(COPY.shared.field.exampleAddress);
    }
    return null;
  };
}

/**
 * A paragraph's control. While hydrating, React writes a stored text back over a `textarea` before any effect can read
 * what a person typed there, so `useEarlyEdit` has nothing to raise and a press would save nothing under
 * „Gespeichert“. So a stored paragraph takes no edit until the page's code runs: `readOnly` paints as the live field
 * does and keeps its Tab stop and the caret a click leaves, where `inert` takes both. An empty one keeps its replay,
 * since React writes nothing there.
 */
function ParagraphBox({ isStored, className }: { isStored: boolean; className: string }) {
  // Upstream: goes with `useEarlyEdit`, since React's own replay writes nothing over a `textarea` it hydrates.
  const isWaiting = useIsSSR();
  return (
    <TextArea
      data-kit-focus="field"
      rows={4}
      readOnly={isWaiting && isStored}
      className={className}
    />
  );
}

/**
 * Type text or a number: the label above, an asterisk after it on a required field, the field at the width of
 * what it holds, then its message line where it has something to say. An error first shows once the value is
 * committed or the form submitted, never while typing.
 */
export function TextField(props: TextFieldProps) {
  const {
    label,
    labelHidden = false,
    description,
    consequence,
    isRequired = false,
    isDisabled = false,
    isLocked = false,
    kind,
    maxLength,
    minLength,
  } = props;
  const keys = KINDS[kind];
  const width = kind === "paragraph" ? "full" : props.holds === undefined ? "standard" : "short";
  const constraints: Constraints = {
    maxLength,
    minLength,
    example:
      props.kind === "url" || props.kind === "minute" ? props.example : kind === "email" || kind === "digits" ? EXAMPLE[kind] : undefined,
  };
  const frame = fieldFrame({ width, holds: props.holds, inset: "full", figures: kind === "digits" || kind === "minute" });
  const field =
    width === "full" ? (
      <ParagraphBox
        isStored={Boolean(props.value ?? props.defaultValue)}
        className={frame}
      />
    ) : (
      <Input
        data-kit-focus="field"
        // Names a short field to the pair around it (`FieldPair`), which leaves it its width.
        data-kit-short={width === "short" || undefined}
        className={frame}
      />
    );
  const unit = fieldUnit({ holds: props.holds });
  const unitId = useId();
  const root = useEarlyEdit();
  const lock = useFieldLock(isDisabled, isLocked, isRequired);

  return (
    <AriaTextField
      ref={root}
      className={fieldRoot()}
      aria-label={labelHidden ? textOf(label) : undefined}
      name={props.name}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={props.onChange}
      isRequired={lock.isRequired}
      validate={judgeOf(kind, lock.isRequired)}
      isDisabled={lock.isDisabled}
      maxLength={maxLength}
      minLength={minLength}
      type={keys.type}
      inputMode={keys.inputMode}
      pattern={props.pattern ?? keys.pattern}
      autoComplete={props.autofill ?? keys.autoComplete}
      aria-describedby={props.unit === undefined ? undefined : unitId}>
      {!labelHidden && (
        <FieldLabel
          label={label}
          isRequired={lock.isRequired}
          isLocked={lock.isMarked}
        />
      )}
      {props.unit === undefined ? (
        field
      ) : (
        // The frame is the group, as a date's or a combo box's is, and rings as a whole while its input is focused.
        <div
          data-kit-focus="field"
          data-kit-short
          className={fieldFrame({ width: "short", inset: "full", class: unit.frame() })}>
          <Input
            data-kit-focus
            className={unit.value()}
          />
          {/* Read once, as the input's description, and hidden where it stands, so browsing past the field does
              not read it a second time: the label names what the figure counts, the unit what it counts in. */}
          <span
            id={unitId}
            aria-hidden
            className={unit.unit()}>
            {props.unit}
          </span>
        </div>
      )}
      <MessageLine
        description={description}
        consequence={consequence}
        constraints={constraints}
      />
    </AriaTextField>
  );
}
