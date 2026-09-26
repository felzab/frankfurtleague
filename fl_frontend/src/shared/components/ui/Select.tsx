"use client";

import { Select as HeroUISelect } from "@heroui/react/select";

import { useRequiredMark } from "./RequiredMarks";

import type { SelectRootProps } from "@heroui/react/select";

/**
 * HeroUI's select, required exactly where its form's schema refuses no pick. `isRequired` is for a
 * rule outside the field's own schema, which each site names.
 */
function SelectRoot<T extends object = object, M extends "single" | "multiple" = "single">({
  isRequired,
  ...props
}: Omit<SelectRootProps<T, M>, "isRequired"> & { isRequired?: boolean }) {
  const derived = useRequiredMark(props.name, null);

  return (
    <HeroUISelect<T, M>
      {...props}
      isRequired={isRequired ?? derived}
    />
  );
}

export const Select = Object.assign(SelectRoot, {
  Trigger: HeroUISelect.Trigger,
  Value: HeroUISelect.Value,
  Indicator: HeroUISelect.Indicator,
  ClearButton: HeroUISelect.ClearButton,
  Popover: HeroUISelect.Popover,
});
