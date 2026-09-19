"use client";

import { FieldError, Input, TextField } from "@heroui/react";

import { NUMMER_MAX_LENGTH } from "@/features/spieler/constants";
import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";

import type { ReactNode } from "react";

/** The squad number on the create dialog and on the squad editor alike, so neither caps or words it apart from the other. */
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
  /** For the editor, which judges a typed field once it is left; the dialog judges on submit. */
  onBlur?: () => void;
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
        className={`${FIELD_INPUT} font-extrabold tracking-wider`}
      />
      {/* Bare: every refusal here is the schema's German, arriving by `name` through the form's
          `validationErrors`. react-aria fills `validationDetails` from native validity in `native`
          mode alone, so a branch on it never fires. */}
      <FieldError className={FIELD_ERROR} />
    </TextField>
  );
}
