"use client";

import { FieldError, Input, Label, NumberField, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";

import type { FieldErrors } from "@/shared/utils/validation";
import type { SchiedsrichterDraft } from "../../types";

/**
 * Every field carries a `name` matching its path in the create/patch payload, and a `FieldError` to
 * render what the server said about it. The two go together: `Form`'s `validationErrors` are looked
 * up by field name, so a mismatch here means a server error that lands nowhere (R4 §3.1).
 */
export default function SchiedsrichterFormFields<T extends SchiedsrichterDraft>({
  draft,
  onChange,
  errors,
}: {
  draft: T;
  onChange: (updatedDraft: T) => void;
  /**
   * Server messages keyed by payload path, for the inline-create panel — it renders inside the match
   * form's `<form>`, so `Form`'s `validationErrors` context cannot reach it. Left undefined by the
   * `EntityForm` callers, where the context supplies the same messages to the same `<FieldError>`s.
   */
  errors?: FieldErrors;
}) {
  return (
    <>
      {/* 1. Name */}
      <TextField
        isRequired
        name="name"
        isInvalid={errors ? !!errors["name"] : undefined}>
        <Label className="text-fluid-sm text-foreground font-bold">Name</Label>
        <Input
          placeholder="z.B. Pierluigi Collina"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["name"]}</FieldError>
      </TextField>

      {/* 2. Schule / Verein */}
      <TextField
        name="schule"
        isInvalid={errors ? !!errors["schule"] : undefined}>
        <Label className="text-fluid-sm text-foreground font-bold">Schule / Verein </Label>
        <Input
          placeholder="z.B. Goethe-Gymnasium"
          value={draft.schule ?? ""}
          onChange={(e) => onChange({ ...draft, schule: e.target.value })}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["schule"]}</FieldError>
      </TextField>

      {/* 3. E-Mail */}
      <TextField
        type="email"
        name="kontakt.email"
        isInvalid={errors ? !!errors["kontakt.email"] : undefined}>
        <Label className="text-fluid-sm text-foreground font-bold">E-Mail </Label>
        <Input
          placeholder="z.B. ref@beispiel.de"
          value={draft.kontakt.email ?? ""}
          onChange={(e) => onChange({ ...draft, kontakt: { ...draft.kontakt, email: e.target.value } })}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["kontakt.email"]}</FieldError>
      </TextField>

      {/* 4. Telefon */}
      <TextField
        type="tel"
        name="kontakt.telefon"
        isInvalid={errors ? !!errors["kontakt.telefon"] : undefined}>
        <Label className="text-fluid-sm text-foreground font-bold">Telefon</Label>
        <Input
          placeholder="z.B. 0151 12345678"
          value={draft.kontakt.telefon ?? ""}
          onChange={(e) => onChange({ ...draft, kontakt: { ...draft.kontakt, telefon: e.target.value } })}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["kontakt.telefon"]}</FieldError>
      </TextField>

      {/* 5. Standard Honorar */}
      <NumberField
        minValue={0}
        isRequired
        name="default_payment"
        isInvalid={errors ? !!errors["default_payment"] : undefined}
        step={5}
        value={draft.default_payment}
        onChange={(val) =>
          onChange({
            ...draft,
            default_payment: val === undefined || isNaN(val) ? 0 : val,
          })
        }
        formatOptions={{ style: "currency", currency: "EUR" }}>
        <Label className="text-fluid-xs text-foreground font-bold">Standard Honorar</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border transition-colors">
          <NumberField.DecrementButton />
          <NumberField.Input className="text-fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR}>{errors?.["default_payment"]}</FieldError>
      </NumberField>
    </>
  );
}
