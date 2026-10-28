"use client";

import { useEffect, useRef, useState } from "react";

import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { asSignInIdentifier } from "@/core/emailAddress";
import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";

import { FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES } from "./formFieldStyles";
import { TextField } from "./TextField";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm";
import type { StepUpDemand } from "./stepUp";

/** Handed whole to `ConfirmTypedAddress`, as `useTypedAddressConfirm` returns it. */
interface TypedAddressField {
  readonly address: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
}

const isTheAddress = (typed: string, address: string): boolean => {
  // Both sides as every identity comparison folds an address, never a looser fold: a spelling it merges and the
  // server keeps apart would open the press on an identifier that is not this person's.
  const key = asSignInIdentifier(typed);

  // An empty box matches nothing, an empty address included.
  return key !== "" && key === asSignInIdentifier(address);
};

/**
 * The two-press control whose armed press stays closed until `address` is typed into `ConfirmTypedAddress`, which
 * the caller places inside its `ConfirmReveal`. Arming, the double-press window, the step-up and the press refused
 * in flight stay `useTwoPressConfirm`'s.
 */
export function useTypedAddressConfirm(address: string, { stepUp = false }: { stepUp?: StepUpDemand } = {}) {
  const [value, setValue] = useState("");
  const matches = isTheAddress(value, address);

  // The control's own armed state, read at the press: the hook runs the guard on both presses, and the arming one
  // comes before there is a field to type into. A confirming press the closure below missed is refused here.
  const twoPress: TwoPressConfirm = useTwoPressConfirm({ guard: () => !twoPress.isConfirming || matches, stepUp });

  const confirm: TwoPressConfirm = {
    ...twoPress,
    press: (write) => {
      // Emptied on every arming: an address kept from a cancelled one would open the press the moment the alert stands.
      if (!twoPress.isConfirming) setValue("");
      twoPress.press(write);
    },
  };

  const field: TypedAddressField = { address, value, onChange: setValue };

  // On the press, never a sentence beside it that each keystroke would mount or unmount.
  const reason = twoPress.isConfirming && !matches ? "Gib zuerst die Adresse ein." : null;

  return { confirm, field, reason };
}

/** The field of `useTypedAddressConfirm`, mounted inside the caller's `ConfirmReveal` and so with the arming. */
export function ConfirmTypedAddress({ field }: { field: TypedAddressField }) {
  // Moved on mount rather than through `autoFocus`, which is banned for a load-time grab: the arming closed the press
  // it was made from, and the address is what the next keystroke is for.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <TextField
      className="flex w-full flex-col gap-y-2"
      value={field.value}
      onChange={field.onChange}>
      <Label className={FIELD_LABEL_CLASSES}>{`Gib zur Bestätigung die Adresse „${field.address}“ ein`}</Label>
      {/* Off, so a value the browser kept is never offered: what opens the press is typed for this arming. */}
      <Input
        ref={inputRef}
        autoComplete="off"
        className={FIELD_INPUT_CLASSES}
      />
    </TextField>
  );
}
