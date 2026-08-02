"use client";

import { FieldError, Input, Label, NumberField, TextField } from "@heroui/react";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";

import type { FieldErrors } from "@/shared/utils/validation";
import type { SpielortDraft } from "../../types";

/** Field names match their path in the create/patch payload — see `SchiedsrichterFormFields`. */
export function SpielortFormFields<T extends SpielortDraft>({
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
      <TextField
        isRequired
        name="name"
        value={draft.name}
        onChange={(next) => onChange({ ...draft, name: next })}
        // See `SchiedsrichterFormFields` for why the value lives on the field, not the input.
        isInvalid={errors?.["name"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Name</Label>
        <Input
          placeholder="z.B. Sportpark Nord"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["name"]}</FieldError>
      </TextField>

      <AddressFields
        value={draft.address}
        onChange={(newAddress) => onChange({ ...draft, address: newAddress })}
        errors={errors}
      />

      <NumberField
        minValue={0}
        isRequired
        name="default_mietpreis"
        isInvalid={errors?.["default_mietpreis"] ? true : undefined}
        step={5}
        value={draft.default_mietpreis}
        onChange={(val) =>
          onChange({
            ...draft,
            default_mietpreis: val === undefined || isNaN(val) ? 0 : val,
          })
        }
        formatOptions={{ style: "currency", currency: "EUR" }}>
        <Label className={FIELD_LABEL}>Standard Mietpreis</Label>
        <NumberField.Group className="border-border bg-surface text-foreground rounded-lg border transition-colors">
          <NumberField.DecrementButton />
          <NumberField.Input className="fluid-sm w-full py-0" />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR}>{errors?.["default_mietpreis"]}</FieldError>
      </NumberField>
    </>
  );
}
