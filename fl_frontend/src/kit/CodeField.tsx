"use client";

import { useEffect, useRef, useState } from "react";

import { FieldError } from "react-aria-components/FieldError";
import { Input, TextField } from "react-aria-components/TextField";

import { SIGN_IN_CODE_LENGTH } from "@/core/signInCode";

import { codeBox, codeInput, codeRow, fieldRoot, messageLine } from "./fieldStyles";

import type { Copy } from "@/core/copy";
import type { SyntheticEvent } from "react";

// The boxes are fixed in number and never reorder, so each keeps its position as its key.
const BOXES = Array.from({ length: SIGN_IN_CODE_LENGTH }, (_, index) => index);

/** Only the digits of what was typed, pasted or filled in, as many as a code holds. */
const digitsOf = (text: string) => text.replace(/\D/g, "").slice(0, SIGN_IN_CODE_LENGTH);

/** The caret stays after the last digit, so the box it stands in is always the next one to fill. */
function caretToEnd(event: SyntheticEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  const end = input.value.length;
  if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end);
}

/**
 * The mailed sign-in code: one real input, its six boxes drawn over it, no label above, the address
 * standing in the sentence before them. One input is one field to assistive technology, under one name,
 * and the one a phone or a browser fills with the mailed code or a paste lands in whole. It takes focus as
 * it appears, since it replaces the button pressed to send the code, and the next box to fill shows the
 * field's edge. The form receives the six digits under `name`.
 */
export function CodeField({
  label,
  name,
  error,
  isDisabled = false,
  onComplete,
}: {
  /** Names the field for assistive technology; the sentence above it shows the address. */
  label: Copy;
  name: string;
  /** The refusal of the code, in the message line under the boxes: one or two sentences. */
  error?: Copy;
  isDisabled?: boolean;
  /** Called with the six digits once the last one is in. */
  onComplete?: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Moved on mount rather than through `autoFocus`, which the lint bans for a load-time grab: the field
  // appears in place of the button just pressed, which would leave a keyboard user on the document body.
  useEffect(() => {
    input.current?.focus();
  }, []);

  const change = (value: string) => {
    const digits = digitsOf(value);
    setCode(digits);
    if (digits.length === SIGN_IN_CODE_LENGTH && digits !== code) onComplete?.(digits);
  };

  // The box the caret stands in: the next to fill, or the last once all six are in.
  const active = Math.min(code.length, SIGN_IN_CODE_LENGTH - 1);

  return (
    <TextField
      className={fieldRoot()}
      aria-label={label}
      name={name}
      value={code}
      onChange={change}
      isDisabled={isDisabled}
      isInvalid={error !== undefined}
      inputMode="numeric"
      autoComplete="one-time-code">
      <div className={codeRow()}>
        {BOXES.map((index) => (
          <div
            key={index}
            aria-hidden
            data-kit-focus="field"
            data-focused={(isFocused && index === active) || undefined}
            className={codeBox()}>
            {code[index]}
          </div>
        ))}
        {/* Over the boxes, its own text and caret transparent: a press on any box lands in it. */}
        <Input
          ref={input}
          data-kit-focus
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onSelect={caretToEnd}
          className={codeInput()}
        />
      </div>
      {error === undefined ? (
        // An empty line holds the place, describing nothing.
        <div className={messageLine({ tone: "error", lines: "several" })} />
      ) : (
        <FieldError className={messageLine({ tone: "error", lines: "several" })}>{error}</FieldError>
      )}
    </TextField>
  );
}
