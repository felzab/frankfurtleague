"use client";

import { ComboBox as HeroUIComboBox } from "@heroui/react/combo-box";

import { useRequiredMark } from "./RequiredMarks";

import type { ComboBoxRootProps } from "@heroui/react/combo-box";

/** HeroUI's combo box, required exactly where its form's schema refuses the text it writes when emptied. */
function ComboBoxRoot<T extends object = object, M extends "single" | "multiple" = "single">(
  props: Omit<ComboBoxRootProps<T, M>, "isRequired">,
) {
  return (
    <HeroUIComboBox<T, M>
      {...props}
      isRequired={useRequiredMark(props.name, "")}
    />
  );
}

export const ComboBox = Object.assign(ComboBoxRoot, {
  InputGroup: HeroUIComboBox.InputGroup,
  Value: HeroUIComboBox.Value,
  Trigger: HeroUIComboBox.Trigger,
  Popover: HeroUIComboBox.Popover,
});
