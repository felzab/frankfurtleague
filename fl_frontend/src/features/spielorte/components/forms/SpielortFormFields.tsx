"use client";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import {
  FIELD_COUNT_INPUT_CLASSES,
  FIELD_ERROR_CLASSES,
  FIELD_GROUP_CLASSES,
  FIELD_INPUT_CLASSES,
  FIELD_LABEL_CLASSES,
} from "@/shared/components/ui/formFieldStyles";
import { NumberField } from "@/shared/components/ui/NumberField";
import { TextField } from "@/shared/components/ui/TextField";

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
  /** For the inline-create panel, inside the match form's `<form>` where `Form`'s `validationErrors` cannot reach. */
  errors?: FieldErrors;
}) {
  return (
    <>
      <TextField
        name="name"
        value={draft.name}
        onChange={(next) => onChange({ ...draft, name: next })}
        // See `SchiedsrichterFormFields` for why the value lives on the field, not the input.
        isInvalid={errors?.["name"] ? true : undefined}>
        <Label className={FIELD_LABEL_CLASSES}>Name</Label>
        <Input
          placeholder="z.B. Sportpark Nord"
          className={FIELD_INPUT_CLASSES}
        />
        <FieldError className={FIELD_ERROR_CLASSES}>{errors?.["name"]}</FieldError>
      </TextField>

      <AddressFields
        value={draft.address}
        onChange={(newAddress) => onChange({ ...draft, address: newAddress })}
        errors={errors}
      />

      <NumberField
        minValue={0}
        name="default_mietpreis"
        isInvalid={errors?.["default_mietpreis"] ? true : undefined}
        step={5}
        value={draft.default_mietpreis}
        onChange={(val) =>
          onChange({
            ...draft,
            default_mietpreis: val,
          })
        }
        formatOptions={{ style: "currency", currency: "EUR" }}>
        <Label className={FIELD_LABEL_CLASSES}>Standard Mietpreis</Label>
        <NumberField.Group className={FIELD_GROUP_CLASSES}>
          <NumberField.DecrementButton />
          <NumberField.Input className={FIELD_COUNT_INPUT_CLASSES} />
          <NumberField.IncrementButton />
        </NumberField.Group>
        <FieldError className={FIELD_ERROR_CLASSES}>{errors?.["default_mietpreis"]}</FieldError>
      </NumberField>
    </>
  );
}
