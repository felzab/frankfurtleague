"use client";

import { FieldError, Input, Label, NumberField, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";

import type { SchiedsrichterDraft } from "../../types";

/**
 * Every field carries a `name` matching its path in the create/patch payload, and a `FieldError` to
 * render what the server said about it. The two go together: `Form`'s `validationErrors` are looked
 * up by field name, so a mismatch here means a server error that lands nowhere (R4 §3.1).
 */
export default function SchiedsrichterFormFields<T extends SchiedsrichterDraft>({
  draft,
  onChange,
}: {
  draft: T;
  onChange: (updatedDraft: T) => void;
}) {
  return (
    <>
      {/* 1. Name */}
      <TextField
        isRequired
        name="name">
        <Label className="text-fluid-sm text-foreground font-bold">Name</Label>
        <Input
          placeholder="z.B. Pierluigi Collina"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR} />
      </TextField>

      {/* 2. Schule / Verein */}
      <TextField name="schule">
        <Label className="text-fluid-sm text-foreground font-bold">Schule / Verein </Label>
        <Input
          placeholder="z.B. Goethe-Gymnasium"
          value={draft.schule ?? ""}
          onChange={(e) => onChange({ ...draft, schule: e.target.value })}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR} />
      </TextField>

      {/* 3. E-Mail */}
      <TextField
        type="email"
        name="kontakt.email">
        <Label className="text-fluid-sm text-foreground font-bold">E-Mail </Label>
        <Input
          placeholder="z.B. ref@beispiel.de"
          value={draft.kontakt.email ?? ""}
          onChange={(e) => onChange({ ...draft, kontakt: { ...draft.kontakt, email: e.target.value } })}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR} />
      </TextField>

      {/* 4. Telefon */}
      <TextField
        type="tel"
        name="kontakt.telefon">
        <Label className="text-fluid-sm text-foreground font-bold">Telefon</Label>
        <Input
          placeholder="z.B. 0151 12345678"
          value={draft.kontakt.telefon ?? ""}
          onChange={(e) => onChange({ ...draft, kontakt: { ...draft.kontakt, telefon: e.target.value } })}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR} />
      </TextField>

      {/* 5. Standard Honorar */}
      <NumberField
        minValue={0}
        isRequired
        name="default_payment"
        step={5}
        value={draft.default_payment ?? NaN}
        // NaN is an emptied field, kept as `null` rather than coerced to 0 — the same defect as the
        // match form's Honorar/Mietpreis (R4 §3.1). `isRequired` blocks the submit and names it.
        onChange={(val) =>
          onChange({
            ...draft,
            default_payment: val === undefined || isNaN(val) ? null : val,
          })
        }
        formatOptions={{ style: "currency", currency: "EUR" }}>
        <Label className="text-fluid-xs text-foreground font-bold">Standard Honorar</Label>
        <NumberField.Group className="border-border bg-surface text-foreground focus-within:border-brand rounded-lg border transition-colors focus-within:ring-0">
          <NumberField.DecrementButton />
          <NumberField.Input className="text-fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR} />
      </NumberField>
    </>
  );
}
