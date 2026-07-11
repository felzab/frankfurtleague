"use client";

import { Input, Label, TextField } from "@heroui/react";

import type { FLAddress } from "@/shared/schemas";

export default function AddressFields({ value, onChange }: { value: FLAddress; onChange: (newValue: FLAddress) => void }) {
  const updateField = (field: keyof FLAddress, newValue: string) => {
    onChange({ ...value, [field]: newValue });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex gap-2">
        <TextField
          isRequired
          className="w-2/3">
          <Label>Straße</Label>
          <Input
            value={value.strasse}
            onChange={(e) => updateField("strasse", e.target.value)}
          />
        </TextField>
        <TextField
          isRequired
          className="w-1/3">
          <Label>Nr.</Label>
          <Input
            value={value.hausnummer}
            onChange={(e) => updateField("hausnummer", e.target.value)}
          />
        </TextField>
      </div>

      <div className="flex gap-2">
        <TextField
          isRequired
          className="w-1/3">
          <Label>PLZ</Label>
          <Input
            value={value.plz}
            onChange={(e) => updateField("plz", e.target.value)}
          />
        </TextField>
        <TextField
          isRequired
          className="w-2/3">
          <Label>Stadt</Label>
          <Input
            value={value.stadt}
            onChange={(e) => updateField("stadt", e.target.value)}
          />
        </TextField>
      </div>

      <TextField isRequired>
        <Label>Stadtteil</Label>
        <Input
          placeholder="z.B. Nordend"
          value={value.stadtteil}
          onChange={(e) => updateField("stadtteil", e.target.value)}
        />
      </TextField>
    </div>
  );
}
