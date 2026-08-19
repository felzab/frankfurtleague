"use client";

import { FieldError, Input, Label, NumberField, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";

import type { FieldErrors } from "@/shared/utils/validation";
import type { SchiedsrichterDraft } from "../../types";

/**
 * Every field's `name` matches its path in the create/patch payload: `Form` looks its
 * `validationErrors` up by field name, so a mismatch means a server error that lands nowhere.
 */
export function SchiedsrichterFormFields<T extends SchiedsrichterDraft>({
  draft,
  onChange,
  errors,
}: {
  draft: T;
  onChange: (updatedDraft: T) => void;
  /**
   * For the inline-create panel, which renders inside the match form's `<form>` where `Form`'s
   * `validationErrors` context cannot reach it. The `EntityForm` callers leave it undefined.
   */
  errors?: FieldErrors;
}) {
  return (
    <>
      <TextField
        isRequired
        name="name"
        value={draft.name}
        onChange={(next) => onChange({ ...draft, name: next })}
        // `value`/`onChange` belong on the field, not the inner `<Input>`: that is RAC's controlled
        // API, and on the input react-aria's field state never sees a value at all.
        isInvalid={errors?.["name"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Name</Label>
        <Input
          placeholder="z.B. Pierluigi Collina"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["name"]}</FieldError>
      </TextField>

      <TextField
        name="schule"
        value={draft.schule ?? ""}
        onChange={(next) => onChange({ ...draft, schule: next })}
        isInvalid={errors?.["schule"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Schule / Verein </Label>
        <Input
          placeholder="z.B. Goethe-Gymnasium"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["schule"]}</FieldError>
      </TextField>

      <TextField
        type="email"
        name="kontakt.email"
        value={draft.kontakt.email ?? ""}
        onChange={(next) => onChange({ ...draft, kontakt: { ...draft.kontakt, email: next } })}
        isInvalid={errors?.["kontakt.email"] ? true : undefined}>
        <Label className={FIELD_LABEL}>E-Mail </Label>
        <Input
          placeholder="z.B. ref@beispiel.de"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["kontakt.email"]}</FieldError>
      </TextField>

      <TextField
        type="tel"
        name="kontakt.telefon"
        value={draft.kontakt.telefon ?? ""}
        onChange={(next) => onChange({ ...draft, kontakt: { ...draft.kontakt, telefon: next } })}
        isInvalid={errors?.["kontakt.telefon"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Telefon</Label>
        <Input
          placeholder="z.B. 0151 12345678"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["kontakt.telefon"]}</FieldError>
      </TextField>

      <NumberField
        minValue={0}
        isRequired
        name="default_payment"
        isInvalid={errors?.["default_payment"] ? true : undefined}
        step={5}
        value={draft.default_payment}
        onChange={(val) =>
          onChange({
            ...draft,
            default_payment: val === undefined || isNaN(val) ? 0 : val,
          })
        }
        formatOptions={{ style: "currency", currency: "EUR" }}>
        <Label className={FIELD_LABEL}>Standard Honorar</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border transition-colors">
          <NumberField.DecrementButton />
          <NumberField.Input className="fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR}>{errors?.["default_payment"]}</FieldError>
      </NumberField>
    </>
  );
}
