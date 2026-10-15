"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";

import { FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "./formFieldStyles";
import { TextField } from "./TextField";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import type { StepUpDemand } from "./stepUp";

/** Never empty: a field accepting nothing would close the press for good, under a label naming nothing to type. */
type Accepted = readonly [string, ...string[]];

/** Handed whole to `ConfirmTypedName`, as `useTypedNameConfirm` returns it. */
interface TypedNameField {
  readonly accepted: Accepted;
  readonly value: string;
  readonly onChange: (next: string) => void;
}

/**
 * A name as the page draws it, which shows a run of spaces as one and a decomposed umlaut as the composed one: a
 * stricter comparison refuses the name as it reads. Folded as `fl_backend/app/shared/folding.py :: person_name_key`
 * folds one.
 */
const folded = (value: string): string => value.normalize("NFC").trim().split(/\s+/).join(" ").toLowerCase();

const isAccepted = (typed: string, accepted: Accepted): boolean => {
  const key = folded(typed);

  // An empty box matches nothing, a blank accepted value included.
  return key !== "" && accepted.some((value) => folded(value) === key);
};

const ODER = new Intl.ListFormat("de-DE", { style: "long", type: "disjunction" });

/** Each value once, in its first spelling: two records of one person name them alike, and the label would offer the name twice. */
const quoted = (accepted: Accepted): string =>
  ODER.format(
    accepted.filter((value, index) => accepted.findIndex((other) => folded(other) === folded(value)) === index).map((value) => `„${value}“`),
  );

/**
 * The two-press control whose armed press stays closed until one of `accepted` is typed into `ConfirmTypedName`,
 * which the caller places inside its `ConfirmReveal`. Arming, the double-press window, the step-up and the press
 * refused in flight stay `useTwoPressConfirm`'s (`docs/frontend/spec.md :: I37`).
 */
export function useTypedNameConfirm(accepted: Accepted, { stepUp = false }: { stepUp?: StepUpDemand } = {}) {
  const [value, setValue] = useState("");
  const matches = isAccepted(value, accepted);

  // The control's own armed state, read at the press: the hook runs the guard on both presses, and the arming one
  // comes before there is a field to type into. A confirming press the closure below missed is refused here.
  const twoPress: TwoPressConfirm = useTwoPressConfirm({ guard: () => !twoPress.isConfirming || matches, stepUp });

  const confirm: TwoPressConfirm = {
    ...twoPress,
    press: (write) => {
      // Emptied on every arming: a name kept from a cancelled one would open the press the moment the alert stands.
      if (!twoPress.isConfirming) setValue("");
      twoPress.press(write);
    },
  };

  const field: TypedNameField = { accepted, value, onChange: setValue };

  // On the press, never a sentence beside it that each keystroke would mount or unmount (`docs/frontend/spec.md` §1.14).
  const reason = twoPress.isConfirming && !matches ? `Gib zuerst ${quoted(accepted)} ein.` : null;

  return { confirm, field, reason };
}

/** The field of `useTypedNameConfirm`, mounted inside the caller's `ConfirmReveal` and so with the arming. */
export function ConfirmTypedName({ field }: { field: TypedNameField }) {
  // Moved on mount rather than through `autoFocus`, which is banned for a load-time grab: the arming closed the press
  // it was made from, and the name is what the next keystroke is for.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <TextField
      className="flex w-full flex-col gap-y-2"
      value={field.value}
      onChange={field.onChange}>
      <Label className={FIELD_LABEL_CLASSES}>{`Gib zur Bestätigung ${quoted(field.accepted)} ein`}</Label>
      {/* Off, so a value the browser kept is never offered: what opens the press is typed for this arming. */}
      <Input
        ref={inputRef}
        autoComplete="off"
        className={FIELD_INPUT_CLASSES}
      />
    </TextField>
  );
}
