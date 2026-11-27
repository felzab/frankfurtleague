"use client";

import { useId } from "react";

import { Group } from "react-aria-components/Group";
import { TextField as AriaTextField, Input, TextArea } from "react-aria-components/TextField";

import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";
import { isDeliverableAddress, KONTAKT_EMAIL_MAX_LENGTH } from "@/core/emailAddress";

import { FieldLabel, MessageLine, useFieldLock, useFieldWait } from "./FieldParts";
import { fieldFrame, fieldRoot, fieldSignifier, fieldUnit, groupInput } from "./fieldStyles";
import { useBoxRule } from "./HeldForm";
import { Icon } from "./Icon";

import type { BoxRule } from "@/core/boxRules";
import type { Copy, Words } from "@/core/copy";
import type { Constraints } from "./FieldParts";

type Shared = {
  /** The catalogue's words, or a record's own, such as a score field named by its club. */
  label: Words;
  isDisabled?: boolean;
  /**
   * Held fixed by its record, such as a season's points once it has begun: read-only, its label marked with the lock
   * (`useFieldLock`), while the editor's lock line says why.
   */
  isLocked?: boolean;
  /** The box the field posts under, by which its form hands it the rules its lane holds it to (`useBoxRule`). */
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
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
 * What an address field is filled as, only where the person types their own: their address, or, where the address
 * signs in, the account's name, under which a password manager files what it keeps for the site. Every other address
 * field is filled with nothing, since an address typed for somebody else would stay in the browser and be offered to
 * the next form.
 */
type EmailAutofill = "email" | "username";

/**
 * A single line's keyboard, set by `kind`. What the value must meet is its lane's, by the field's `name`
 * (`useBoxRule`), and the field judges it (`judgeOf`).
 */
type Kind =
  | { kind: "text"; autofill?: Autofill }
  | { kind: "digits"; autofill?: Autofill }
  | { kind: "email"; autofill?: EmailAutofill }
  | { kind: "tel"; autofill?: never }
  | { kind: "url"; autofill?: never }
  /** A played minute, stoppage time after a plus, „90+3“. */
  | { kind: "minute"; autofill?: never };

/*
 * A field's width follows from what it holds, so no caller sets one: a value of a known length is short, a paragraph
 * takes its box's whole width, and every other value the one standard width (`fieldFrame`).
 */

/**
 * A value of a known length, as wide as it is: `holds` counts its characters, 2 for a score or a count, 5 for a
 * shirt number, a minute, a price, a postcode or a house number. `unit` stands after the value inside the field, as
 * „€“ after a price.
 */
type Short = { holds: 2 | 5; unit?: Copy } & Kind;

/** A value whose length varies, a name, an address, a phone number or a URL: the one standard width. */
type Standard = { holds?: never; unit?: never } & Kind;

/** A paragraph: its box's whole width at four lines. */
type Paragraph = { kind: "paragraph"; holds?: never; autofill?: never; unit?: never };

export type TextFieldProps = Shared & (Short | Standard | Paragraph);

/**
 * What each kind sets on the input: its type, the keyboard a phone opens, what the browser offers to fill.
 * A text, digits or address field is filled only where its `autofill` names what it asks for. A phone number and a
 * website take `off`, which asks the browser for none of the person's own values and none of its past entries: every
 * one the site asks for is somebody else's, a seat holder's, a referee's or a school's. `off` is a hint, which a
 * browser's address profile may still pass over and offer the person's own number.
 */
const KINDS = {
  text: { type: "text", inputMode: undefined, autoComplete: undefined },
  paragraph: { type: "text", inputMode: undefined, autoComplete: undefined },
  // A count or a figure: a plain field opening the digits keyboard, with no stepper, taking digits alone (`DIGITS`).
  digits: { type: "text", inputMode: "numeric", autoComplete: undefined },
  // The phone pad, which carries the plus beside the digits where `numeric`'s pad carries none; a plain text field
  // under it, so a keyboard whose pad lacks the plus still types one. The pattern is the caller's.
  minute: { type: "text", inputMode: "tel", autoComplete: undefined },
  email: { type: "email", inputMode: undefined, autoComplete: "off" },
  tel: { type: "tel", inputMode: undefined, autoComplete: "off" },
  url: { type: "url", inputMode: undefined, autoComplete: "off" },
} as const;

/** The example a malformed value is shown, by kind, where its lane names none, as a name's or a minute's lane does. */
const EXAMPLE: Partial<Record<TextFieldProps["kind"], Copy>> = {
  email: COPY.shared.field.exampleAddress,
  digits: COPY.shared.field.exampleDigits,
  tel: COPY.shared.field.examplePhone,
  url: COPY.shared.field.exampleUrl,
};

/** A digits field's own: digits alone, so anything else reads „Format: …“ at the send rather than reaching the server. */
const DIGITS = /^[0-9]*$/u;

/** The line a figure outside its lane's bounds reads, naming every bound, as the server's parse names them. */
function boundsLine({ min, max }: BoxRule): Copy | undefined {
  if (min !== undefined && max !== undefined) return COPY.shared.field.between(min, max);
  if (min !== undefined) return COPY.shared.field.min(min);
  return max === undefined ? undefined : COPY.shared.field.max(max);
}

/**
 * What the browser's own check passes and the server refuses, judged on the press so a slip costs no round trip: a
 * required box holding only spaces, which the server trims to nothing; an address outside the API's rule, such as a
 * host with no dot, which `type=email` takes; a value meeting none of its lane's patterns; and a figure outside its
 * lane's bounds. Each in the phrase the server's refusal puts on the box. React Aria shows it once the value is
 * committed or the form pressed, as every field message, and the press goes nowhere while it stands. The sign-in
 * library's own rule and every rule reading a record stay the server's, as does a pattern whose message names no
 * example, which only a pasted control character breaks.
 *
 * A pattern is judged here rather than by the input's `pattern` attribute, which HTML compiles under the `v` flag and
 * anchors whole: the contract's phone pattern is a SyntaxError there, its class holding an unescaped bracket, a browser
 * drops a pattern it cannot compile in silence, and JSON Schema's pattern matches anywhere in the value, as the erasure
 * address's `@` does. Each compiles under `u`, which the name's `\p{L}` needs, and JSON Schema reads it so. The value
 * judged is trimmed, as the action strips what it sends.
 */
function judgeOf(kind: TextFieldProps["kind"], isRequired: boolean, rule: BoxRule) {
  const example = rule.example ?? EXAMPLE[kind];
  const patterns = example === undefined ? [] : (rule.patterns ?? []).map((source) => new RegExp(source, "u"));
  const bounds = boundsLine(rule);
  return (value: string): Copy | null => {
    const trimmed = value.trim();
    if (trimmed === "") return isRequired && value !== "" ? COPY.shared.field.required : null;
    // Past the ceiling the browser's `maxLength`, or the server's, names the length rather than the shape.
    if (kind === "email" && trimmed.length <= KONTAKT_EMAIL_MAX_LENGTH && !isDeliverableAddress(trimmed)) {
      return COPY.shared.field.format(COPY.shared.field.exampleAddress);
    }
    const isShaped =
      (kind !== "digits" || DIGITS.test(trimmed)) && (patterns.length === 0 || patterns.some((pattern) => pattern.test(trimmed)));
    if (!isShaped && example !== undefined) return COPY.shared.field.format(example);
    if (bounds === undefined || kind !== "digits") return null;
    const figure = Number(trimmed);
    return (rule.min !== undefined && figure < rule.min) || (rule.max !== undefined && figure > rule.max) ? bounds : null;
  };
}

/**
 * Type text or a number: the label above, an asterisk after it on a required field, the field at the width of
 * what it holds, then its message line where it has something to say. An error first shows once the value is
 * committed or the form submitted, never while typing.
 */
export function TextField(props: TextFieldProps) {
  const { label, labelHidden = false, description, consequence, isDisabled = false, isLocked = false, kind } = props;
  const rule = useBoxRule(props.name);
  const { maxLength, minLength } = rule;
  const keys = KINDS[kind];
  const width = kind === "paragraph" ? "full" : props.holds === undefined ? "standard" : "short";
  const constraints: Constraints = {
    maxLength,
    minLength,
    // The two kinds whose `type` the browser judges itself; every pattern words its own message (`judgeOf`).
    example: kind === "url" || kind === "email" ? EXAMPLE[kind] : undefined,
  };
  const frame = fieldFrame({ width, holds: props.holds, inset: "full", figures: kind === "digits" || kind === "minute" });
  const field =
    width === "full" ? (
      <TextArea
        data-kit-focus="field"
        rows={4}
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
  const lock = useFieldLock(isLocked, rule.required);

  return (
    <AriaTextField
      inert={useFieldWait()}
      className={fieldRoot()}
      aria-label={labelHidden ? textOf(label) : undefined}
      name={props.name}
      value={props.value}
      defaultValue={props.defaultValue}
      onChange={props.onChange}
      isRequired={lock.isRequired}
      validate={judgeOf(kind, lock.isRequired, rule)}
      isDisabled={isDisabled}
      isReadOnly={lock.isReadOnly}
      maxLength={maxLength}
      minLength={minLength}
      type={keys.type}
      inputMode={keys.inputMode}
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
        // The frame is the group, as a date's or a combo box's is, and rings as a whole while its input is focused. React
        // Aria's, so its hover covers the unit too; presentational, as the text field's own context sets it, since the
        // figure and its unit are one control.
        <Group
          role="presentation"
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
        </Group>
      )}
      <MessageLine
        description={description}
        consequence={consequence}
        constraints={constraints}
      />
    </AriaTextField>
  );
}

/**
 * A select its record holds fixed or its form closed (`Select`), drawn as the answer it shows. React Aria's select takes
 * no read-only state, its props omitting `isReadOnly`, and its closed trigger changes the value by the arrow keys and
 * by typing, so it stands as a read-only text field holding the chosen answer's words: in the trigger's own frame, in
 * every field's read-only look, its arrow a read-only signifier (`fieldSignifier`), reachable by the keys and heard
 * as read-only as every other locked field is. It posts nothing, as a disabled select does, and takes no edit before
 * hydration, its input standing `readOnly` in the server's markup too.
 */
export function ChosenField({
  label,
  labelHidden,
  words,
  isRequired,
  isMarked,
  frame,
  description,
  consequence,
}: {
  label: Words;
  labelHidden: boolean;
  /** The chosen answer's words, or nothing where none is chosen, as the select shows them. */
  words: string;
  /** The select's own answer (`useFieldLock`), which a lock or a closed form never asks. */
  isRequired: boolean;
  isMarked: boolean;
  /** The select trigger's frame, so the field stands at the trigger's size. */
  frame: string;
  description: Copy | undefined;
  consequence: Copy | undefined;
}) {
  return (
    <AriaTextField
      className={fieldRoot()}
      aria-label={labelHidden ? textOf(label) : undefined}
      value={words}
      isReadOnly>
      {!labelHidden && (
        <FieldLabel
          label={label}
          isRequired={isRequired}
          isLocked={isMarked}
        />
      )}
      {/* React Aria's group, as the unit frame is, so the frame carries `data-focus-visible` while the keys hold its
          input: a read-only field rings by that mark alone (`app/focus.css`). Presentational, as the text field's own
          context sets it, since the answer and its arrow are one control. */}
      <Group
        role="presentation"
        data-kit-focus="field"
        className={frame}>
        <Input
          data-kit-focus
          className={groupInput({ class: "truncate" })}
        />
        <span className={fieldSignifier({ class: "flex" })}>
          <Icon
            glyph="expand"
            size={16}
          />
        </span>
      </Group>
      <MessageLine
        description={description}
        consequence={consequence}
      />
    </AriaTextField>
  );
}
