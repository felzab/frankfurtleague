"use client";

import { Select as HeroUISelect } from "@heroui/react/select";

import { useRequiredMark } from "./RequiredMarks";

import type { SelectPopoverProps, SelectRootProps } from "@heroui/react/select";

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

// HeroUI floors the list at the trigger's width and caps it nowhere, so a row's name somebody typed widens
// it to that name's full length, past the screen; capped, a row truncates instead.
const POPOVER_CAP = "max-w-[calc(100vw-2rem)]";

/** HeroUI's list, never wider than the screen it opens on. */
function SelectPopover({ className, ...props }: SelectPopoverProps) {
  return (
    <HeroUISelect.Popover
      {...props}
      className={typeof className === "function" ? (state) => `${className(state)} ${POPOVER_CAP}` : `${className ?? ""} ${POPOVER_CAP}`}
    />
  );
}

export const Select = Object.assign(SelectRoot, {
  Trigger: HeroUISelect.Trigger,
  Value: HeroUISelect.Value,
  Indicator: HeroUISelect.Indicator,
  ClearButton: HeroUISelect.ClearButton,
  Popover: SelectPopover,
});
