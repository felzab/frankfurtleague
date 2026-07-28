"use client";

import { Input, Label, NumberField, TextField } from "@heroui/react";

export interface SchiedsrichterDraft {
  name: string;
  schule: string | null;
  default_payment: number;
  kontakt: {
    telefon: string | null;
    email: string | null;
  };
}

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
      <TextField isRequired>
        <Label className="text-fluid-sm text-foreground font-bold">Name</Label>
        <Input
          placeholder="z.B. Pierluigi Collina"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
        />
      </TextField>

      {/* 2. Schule / Verein */}
      <TextField>
        <Label className="text-fluid-sm text-foreground font-bold">Schule / Verein </Label>
        <Input
          placeholder="z.B. Goethe-Gymnasium"
          value={draft.schule ?? ""}
          onChange={(e) => onChange({ ...draft, schule: e.target.value })}
          className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
        />
      </TextField>

      {/* 3. E-Mail */}
      <TextField type="email">
        <Label className="text-fluid-sm text-foreground font-bold">E-Mail </Label>
        <Input
          placeholder="z.B. ref@beispiel.de"
          value={draft.kontakt.email ?? ""}
          onChange={(e) => onChange({ ...draft, kontakt: { ...draft.kontakt, email: e.target.value } })}
          className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
        />
      </TextField>

      {/* 4. Telefon */}
      <TextField type="tel">
        <Label className="text-fluid-sm text-foreground font-bold">Telefon</Label>
        <Input
          placeholder="z.B. 0151 12345678"
          value={draft.kontakt.telefon ?? ""}
          onChange={(e) => onChange({ ...draft, kontakt: { ...draft.kontakt, telefon: e.target.value } })}
          className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
        />
      </TextField>

      {/* 5. Standard Honorar */}
      <NumberField
        minValue={0}
        isRequired
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
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <NumberField.DecrementButton />
          <NumberField.Input className="text-fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>
    </>
  );
}
