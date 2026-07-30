"use client";

import { Input, Label, TextField } from "@heroui/react";

import { FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";

import type { FLAddress } from "@/shared/schemas";

export default function AddressFields({ value, onChange }: { value: FLAddress; onChange: (newValue: FLAddress) => void }) {
  const updateField = (field: keyof FLAddress, newValue: string) => {
    onChange({ ...value, [field]: newValue });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex gap-3">
        <TextField
          isRequired
          className="w-2/3">
          <Label className="text-fluid-xs text-foreground font-bold">Straße</Label>
          <Input
            value={value.strasse}
            onChange={(e) => updateField("strasse", e.target.value)}
            className={FIELD_INPUT}
          />
        </TextField>
        <TextField
          isRequired
          className="w-1/3">
          <Label className="text-fluid-xs text-foreground font-bold">Nr.</Label>
          <Input
            value={value.hausnummer}
            onChange={(e) => updateField("hausnummer", e.target.value)}
            className={FIELD_INPUT}
          />
        </TextField>
      </div>

      <div className="flex gap-3">
        <TextField
          isRequired
          className="w-1/3">
          <Label className="text-fluid-xs text-foreground font-bold">PLZ</Label>
          <Input
            value={value.plz}
            onChange={(e) => updateField("plz", e.target.value)}
            className={FIELD_INPUT}
          />
        </TextField>
        <TextField
          isRequired
          className="w-2/3">
          <Label className="text-fluid-xs text-foreground font-bold">Stadt</Label>
          <Input
            value={value.stadt}
            onChange={(e) => updateField("stadt", e.target.value)}
            className={FIELD_INPUT}
          />
        </TextField>
      </div>

      <TextField isRequired>
        <Label className="text-fluid-xs text-foreground font-bold">Stadtteil</Label>
        <Input
          placeholder="z.B. Nordend"
          value={value.stadtteil}
          onChange={(e) => updateField("stadtteil", e.target.value)}
          className={FIELD_INPUT}
        />
      </TextField>
    </div>
  );
}
