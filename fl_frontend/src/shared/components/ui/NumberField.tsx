"use client";

import { NumberField as HeroUINumberField } from "@heroui/react/number-field";

import { enteredNumber } from "@/shared/utils/numberField";

import { useRequiredMark } from "./RequiredMarks";

import type { NumberFieldRootProps } from "@heroui/react/number-field";

/**
 * HeroUI's number field with an empty box spelled `null` both ways. react-aria speaks `NaN` for an
 * empty box, and a caller translating by hand reaches for `?? 0`, which saves a number nobody typed.
 */
function NumberFieldRoot({
  value,
  onChange,
  ...props
}: Omit<NumberFieldRootProps, "value" | "defaultValue" | "onChange" | "isRequired"> & {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <HeroUINumberField
      {...props}
      isRequired={useRequiredMark(props.name, null)}
      value={value ?? Number.NaN}
      onChange={(next) => onChange(enteredNumber(next))}
    />
  );
}

export const NumberField = Object.assign(NumberFieldRoot, {
  Group: HeroUINumberField.Group,
  Input: HeroUINumberField.Input,
  DecrementButton: HeroUINumberField.DecrementButton,
  IncrementButton: HeroUINumberField.IncrementButton,
});
