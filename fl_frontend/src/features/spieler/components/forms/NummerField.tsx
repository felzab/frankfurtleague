"use client";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";

import { NUMMER_MAX_LENGTH } from "@/features/spieler/constants";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { TextField } from "@/shared/components/ui/TextField";

import type { ReactNode } from "react";

/** The squad number on the squad editor and on the registration form alike, so neither caps or words it apart from the other. */
export function NummerField({
  label,
  value,
  onChange,
  onBlur,
}: {
  label: ReactNode;
  /** The box as typed. Emptied-means-absent is the caller's boundary, where its payload is built. */
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
}) {
  return (
    <TextField
      name="nummer"
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      maxLength={NUMMER_MAX_LENGTH}
      // No `pattern` beside it: under `validationBehavior="aria"` the browser judges nothing, and the
      // schema's regex is the one judge of the format.
      inputMode="numeric">
      {label}
      <Input
        placeholder="z.B. 7"
        className={`${FIELD_INPUT_CLASSES} font-extrabold tracking-wider`}
      />
      {/* Bare: every refusal here is the schema's German, arriving by `name` through the form's
          `validationErrors`. react-aria fills `validationDetails` from native validity in `native`
          mode alone, so a branch on it never fires. */}
      <FieldError className={FIELD_ERROR_CLASSES} />
    </TextField>
  );
}
