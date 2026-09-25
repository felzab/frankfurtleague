"use client";

import { Autocomplete as HeroUIAutocomplete } from "@heroui/react/autocomplete";

import { useRequiredMark } from "./RequiredMarks";

import type { AutocompleteRootProps } from "@heroui/react/autocomplete";

/**
 * HeroUI's autocomplete, required exactly where its form's schema refuses no pick. `isRequired` is for
 * a rule outside the field's own schema, which each site names.
 */
function AutocompleteRoot<T extends object = object, M extends "single" | "multiple" = "single">({
  isRequired,
  ...props
}: Omit<AutocompleteRootProps<T, M>, "isRequired"> & { isRequired?: boolean }) {
  const derived = useRequiredMark(props.name, null);

  return (
    <HeroUIAutocomplete<T, M>
      {...props}
      isRequired={isRequired ?? derived}
    />
  );
}

export const Autocomplete = Object.assign(AutocompleteRoot, {
  Trigger: HeroUIAutocomplete.Trigger,
  Value: HeroUIAutocomplete.Value,
  Indicator: HeroUIAutocomplete.Indicator,
  Popover: HeroUIAutocomplete.Popover,
  Filter: HeroUIAutocomplete.Filter,
  ClearButton: HeroUIAutocomplete.ClearButton,
});
