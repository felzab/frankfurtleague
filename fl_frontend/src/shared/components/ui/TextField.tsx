"use client";

import { TextField as HeroUITextField } from "@heroui/react/textfield";

import { useRequiredMark } from "./RequiredMarks";

import type { TextFieldRootProps } from "@heroui/react/textfield";

/** HeroUI's text field, required exactly where its form's schema refuses the emptied box. */
export function TextField(props: Omit<TextFieldRootProps, "isRequired">) {
  return (
    <HeroUITextField
      {...props}
      isRequired={useRequiredMark(props.name, "")}
    />
  );
}
