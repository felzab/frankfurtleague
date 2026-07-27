"use client";

import AddressFields from "@/shared/components/ui/AddressFields";

import { Input, Label, NumberField, TextField } from "@heroui/react";

import type { FLAddress } from "@/shared/schemas";

export interface SpielortDraft {
  name: string;
  address: FLAddress;
  default_mietpreis: number;
}

export default function SpielortFormFields<T extends SpielortDraft>({ draft, onChange }: { draft: T; onChange: (updatedDraft: T) => void }) {
  return (
    <>
      <TextField isRequired>
        <Label className="text-fluid-sm xt-foreground font-bold">Name</Label>
        <Input
          placeholder="z.B. Sportpark Nord"
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          className="border-border text-fluid-sm bg-surface text-foreground rounded-lg border px-3 py-2"
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
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border">
          <NumberField.DecrementButton />
          <NumberField.Input className="text-fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
      </NumberField>
    </>
  );
}
