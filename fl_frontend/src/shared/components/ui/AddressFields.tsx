"use client";

import { FieldError, Input, Label, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";

import type { FLAddress } from "@/shared/schemas";

/**
 * The shared address editor.
 *
 * `namePrefix` is what lets it report validation at all (R4 §3.3). It had no error channel of any
 * kind: five fields, no `name`, no error slot, so a server-side "PLZ muss genau 5 Ziffern haben"
 * could only ever surface as a toast that named no field. Naming each input after its dotted path
 * in the enclosing payload is enough — react-aria's `Form` distributes `validationErrors` by field
 * name, so no error prop has to be threaded down.
 */
export default function AddressFields({
  value,
  onChange,
  namePrefix = "address",
}: {
  value: FLAddress;
  onChange: (newValue: FLAddress) => void;
  /** The address object's own path in the payload, so field names match the server's error keys. */
  namePrefix?: string;
}) {
  const updateField = (field: keyof FLAddress, newValue: string) => {
    onChange({ ...value, [field]: newValue });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex gap-3">
        <TextField
          isRequired
          name={`${namePrefix}.strasse`}
          className="w-2/3">
          <Label className="text-fluid-xs text-foreground font-bold">Straße</Label>
          <Input
            value={value.strasse}
            onChange={(e) => updateField("strasse", e.target.value)}
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>
        <TextField
          isRequired
          name={`${namePrefix}.hausnummer`}
          className="w-1/3">
          <Label className="text-fluid-xs text-foreground font-bold">Nr.</Label>
          <Input
            value={value.hausnummer}
            onChange={(e) => updateField("hausnummer", e.target.value)}
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>
      </div>

      <div className="flex gap-3">
        <TextField
          isRequired
          name={`${namePrefix}.plz`}
          validate={(plz) => (/^\d{5}$/.test(plz) ? null : "Die PLZ muss genau 5 Ziffern haben.")}
          className="w-1/3">
          <Label className="text-fluid-xs text-foreground font-bold">PLZ</Label>
          <Input
            value={value.plz}
            onChange={(e) => updateField("plz", e.target.value)}
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>
        <TextField
          isRequired
          name={`${namePrefix}.stadt`}
          className="w-2/3">
          <Label className="text-fluid-xs text-foreground font-bold">Stadt</Label>
          <Input
            value={value.stadt}
            onChange={(e) => updateField("stadt", e.target.value)}
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR} />
        </TextField>
      </div>

      <TextField
        isRequired
        name={`${namePrefix}.stadtteil`}>
        <Label className="text-fluid-xs text-foreground font-bold">Stadtteil</Label>
        <Input
          placeholder="z.B. Nordend"
          value={value.stadtteil}
          onChange={(e) => updateField("stadtteil", e.target.value)}
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR} />
      </TextField>
    </div>
  );
}
