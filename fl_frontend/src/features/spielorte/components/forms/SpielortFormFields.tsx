"use client";

import { Input, Label, NumberField, TextField } from "@heroui/react";

import AddressFields from "@/shared/components/ui/AddressFields";
import { FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";

import type { SpielortDraft } from "../../types";

export default function SpielortFormFields<T extends SpielortDraft>({ draft, onChange }: { draft: T; onChange: (updatedDraft: T) => void }) {
  return (
    <>
      <TextField isRequired>
        <Label className="text-fluid-sm text-foreground font-bold">Name</Label>
        <Input
          placeholder="z.B. Sportpark Nord"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className={FIELD_INPUT}
        />
      </TextField>

      <AddressFields
        value={draft.address}
        onChange={(newAddress) => onChange({ ...draft, address: newAddress })}
      />

      <NumberField
        minValue={0}
        isRequired
        step={5}
        value={draft.default_mietpreis}
        onChange={(val) =>
          onChange({
            ...draft,
            default_mietpreis: val === undefined || isNaN(val) ? 0 : val,
          })
        }
        formatOptions={{ style: "currency", currency: "EUR" }}>
        <Label className="text-fluid-xs text-foreground font-bold">Standard Mietpreis</Label>
        <NumberField.Group className="border-border bg-surface text-foreground focus-within:border-brand rounded-lg border transition-colors focus-within:ring-0">
          <NumberField.DecrementButton />
          <NumberField.Input className="text-fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>
    </>
  );
}
