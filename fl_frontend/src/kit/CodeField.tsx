"use client";

import { useId, useRef, useState } from "react";

import { Group } from "react-aria-components/Group";
import { Input } from "react-aria-components/Input";

import { codeBox, codeRow, fieldRoot, messageLine } from "./fieldStyles";

import type { Copy } from "@/core/copy";
import type { ChangeEvent, KeyboardEvent } from "react";

const LAENGE = 6;

// The boxes are fixed in number and never reorder, so each keeps its position as its key.
const BOXES = Array.from({ length: LAENGE }, (_, index) => index);

/** What one box was given: with its digit selected on focus a keystroke replaces it, else the new one is kept. */
const typed = (raw: string, held: string) => (raw.length === 2 && raw.includes(held) ? raw.replace(held, "") : raw);

/**
 * The mailed sign-in code: six boxes, no label above, the address standing in the sentence before them.
 * React Aria has no code field, so this one is built on its input and group. Each box takes one digit;
 * a code pasted or filled in by the browser lands in all six, the first box offering it as the
 * one-time code. The form receives the six digits as one value under `name`.
 */
export function CodeField({
  label,
  name,
  error,
  isDisabled = false,
  onComplete,
}: {
  /** Names the boxes for assistive technology; the sentence above them shows the address. */
  label: Copy;
  name: string;
  /** The refusal of the code, in the message line under the boxes. */
  error?: Copy;
  isDisabled?: boolean;
  /** Called with the six digits once the last box is filled. */
  onComplete?: (code: string) => void;
}) {
  const [ziffern, setZiffern] = useState<readonly string[]>(() => Array.from({ length: LAENGE }, () => ""));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const lineId = useId();

  const focusBox = (index: number) => boxes.current[Math.max(0, Math.min(LAENGE - 1, index))]?.focus();

  // Writes the digits typed or pasted into box `from` onwards, and moves to the box after the last one.
  const write = (from: number, text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, LAENGE - from);
    const next = [...ziffern];
    if (digits === "") {
      next[from] = "";
    } else {
      [...digits].forEach((digit, offset) => {
        next[from + offset] = digit;
      });
      focusBox(from + digits.length);
    }
    setZiffern(next);
    if (next.every((digit) => digit !== "")) onComplete?.(next.join(""));
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && ziffern[index] === "" && index > 0) {
      event.preventDefault();
      write(index - 1, "");
      focusBox(index - 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  };

  return (
    <div className={fieldRoot()}>
      <Group
        aria-label={label}
        isDisabled={isDisabled}
        isInvalid={error !== undefined}
        className={codeRow()}>
        {BOXES.map((index) => (
          <Input
            key={index}
            ref={(element) => {
              boxes.current[index] = element;
            }}
            data-kit-focus="field"
            aria-label={label}
            aria-describedby={error === undefined ? undefined : lineId}
            aria-invalid={error !== undefined || undefined}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            disabled={isDisabled}
            value={ziffern[index]}
            onChange={(event: ChangeEvent<HTMLInputElement>) => write(index, typed(event.target.value, ziffern[index] ?? ""))}
            onKeyDown={onKeyDown(index)}
            onFocus={(event) => event.target.select()}
            className={codeBox()}
          />
        ))}
      </Group>
      <input
        type="hidden"
        name={name}
        value={ziffern.join("")}
      />
      <div
        id={lineId}
        className={messageLine({ tone: "error" })}>
        {error}
      </div>
    </div>
  );
}
