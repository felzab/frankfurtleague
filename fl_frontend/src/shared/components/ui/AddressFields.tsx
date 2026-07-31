"use client";

import { FieldError, Input, Label, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT } from "@/shared/components/ui/formFieldStyles";

import type { FLAddress } from "@/shared/schemas";
import type { FieldErrors } from "@/shared/utils/validation";

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
  errors,
}: {
  value: FLAddress;
  onChange: (newValue: FLAddress) => void;
  /** The address object's own path in the payload, so field names match the server's error keys. */
  namePrefix?: string;
  /**
   * Server messages keyed by the same dotted path, for the one caller that has no `<Form>` above it:
   * the inline-create panel renders inside the match form's `<form>` and cannot be one itself, so
   * `Form`'s `validationErrors` context never reaches it. Everywhere else this stays undefined and
   * the context does the work — both routes end at the same `<FieldError>` under the same input.
   */
  errors?: FieldErrors;
}) {
  const updateField = (field: keyof FLAddress, newValue: string) => {
    onChange({ ...value, [field]: newValue });
  };

  /** German replacement for the browser's own required message, which follows the browser's UI
   *  language and not the page's. Only reachable because `TextField` owns the value below. */
  const required = (label: string) => (fieldValue: string) => (fieldValue.trim().length === 0 ? `Bitte gib ${label} ein.` : null);

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex gap-3">
        <TextField
          isRequired
          name={`${namePrefix}.strasse`}
          value={value.strasse}
          onChange={(next) => updateField("strasse", next)}
          validate={required("eine Straße")}
          isInvalid={errors ? !!errors[`${namePrefix}.strasse`] : undefined}
          className="w-2/3">
          <Label className="text-fluid-xs text-foreground font-bold">Straße</Label>
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.strasse`]}</FieldError>
        </TextField>
        <TextField
          isRequired
          name={`${namePrefix}.hausnummer`}
          value={value.hausnummer}
          onChange={(next) => updateField("hausnummer", next)}
          validate={required("eine Hausnummer")}
          isInvalid={errors ? !!errors[`${namePrefix}.hausnummer`] : undefined}
          className="w-1/3">
          <Label className="text-fluid-xs text-foreground font-bold">Nr.</Label>
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.hausnummer`]}</FieldError>
        </TextField>
      </div>

      <div className="flex gap-3">
        <TextField
          isRequired
          name={`${namePrefix}.plz`}
          value={value.plz}
          onChange={(next) => updateField("plz", next)}
          validate={required("eine PLZ")}
          isInvalid={errors ? !!errors[`${namePrefix}.plz`] : undefined}
          className="w-1/3">
          <Label className="text-fluid-xs text-foreground font-bold">PLZ</Label>
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.plz`]}</FieldError>
        </TextField>
        <TextField
          isRequired
          name={`${namePrefix}.stadt`}
          value={value.stadt}
          onChange={(next) => updateField("stadt", next)}
          validate={required("eine Stadt")}
          isInvalid={errors ? !!errors[`${namePrefix}.stadt`] : undefined}
          className="w-2/3">
          <Label className="text-fluid-xs text-foreground font-bold">Stadt</Label>
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.stadt`]}</FieldError>
        </TextField>
      </div>

      <TextField
        isRequired
        name={`${namePrefix}.stadtteil`}
        value={value.stadtteil}
        onChange={(next) => updateField("stadtteil", next)}
        validate={required("einen Stadtteil")}
        isInvalid={errors ? !!errors[`${namePrefix}.stadtteil`] : undefined}>
        <Label className="text-fluid-xs text-foreground font-bold">Stadtteil</Label>
        <Input
          placeholder="z.B. Nordend"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.stadtteil`]}</FieldError>
      </TextField>
    </div>
  );
}
