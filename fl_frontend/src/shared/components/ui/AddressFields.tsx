"use client";

import { FieldError, Input, Label, TextField } from "@heroui/react";

import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";
import {
  ADDRESS_HAUSNUMMER_MAX_LENGTH,
  ADDRESS_STADT_MAX_LENGTH,
  ADDRESS_STADTTEIL_MAX_LENGTH,
  ADDRESS_STRASSE_MAX_LENGTH,
} from "@/shared/schemas";

import type { FLAddress } from "@/shared/schemas";
import type { FieldErrors } from "@/shared/utils/validation";
import type { ReactNode } from "react";

/**
 * The shared address editor. Naming each input after its dotted path in the enclosing payload is the whole error
 * channel: react-aria's `Form` distributes `validationErrors` by field name, so no error prop is threaded down.
 */
export function AddressFields({
  value,
  onChange,
  namePrefix = "address",
  errors,
  onFieldLeft,
  renderLabel,
  isStadtteilRequired = false,
  describedById,
}: {
  value: FLAddress;
  onChange: (newValue: FLAddress) => void;
  /** The address object's own path in the payload, so field names match the server's error keys. */
  namePrefix?: string;
  /**
   * For a caller with no `<Form>` above it — the inline-create panel renders inside another form and cannot be one, so
   * the `validationErrors` context never reaches it. Everywhere else this stays undefined.
   */
  errors?: FieldErrors;
  /** For a caller that judges a typed field on blur; the dialog callers pass nothing and judge on submit. */
  onFieldLeft?: (paths: readonly string[]) => void;
  /** Replaces each plain `<Label>`, for a page editor whose labels carry draft markers and anchors. */
  renderLabel?: (path: string, text: string) => ReactNode;
  /**
   * On only where the payload requires a district — the application form's. `validationBehavior="aria"`
   * drops the native attribute (`requiredMarking.test.ts`), so this marks and describes the field and
   * the payload schema is what refuses an empty one.
   */
  isStadtteilRequired?: boolean;
  /**
   * A sentence standing above the block that qualifies the whole address rather than one field. It reaches every input
   * here, `FormKontaktpersonenSection`'s shape: a group hint a control is not described BY is one a reader never meets.
   */
  describedById?: string;
}) {
  const updateField = (field: keyof FLAddress, newValue: string) => {
    onChange({ ...value, [field]: newValue });
  };

  return (
    <div className="flex w-full flex-col gap-4">
      {/* The 2:1 split is over the free space: two percentage widths summing to 100% put the whole
          `gap-3` past the container. `min-w-0` because a field's automatic minimum is its input's
          intrinsic width, which no shrinking goes under. */}
      <div className="flex gap-3">
        <TextField
          isRequired
          name={`${namePrefix}.strasse`}
          aria-describedby={describedById}
          value={value.strasse}
          onChange={(next) => updateField("strasse", next)}
          onBlur={() => onFieldLeft?.([`${namePrefix}.strasse`])}
          maxLength={ADDRESS_STRASSE_MAX_LENGTH}
          isInvalid={errors?.[`${namePrefix}.strasse`] ? true : undefined}
          className="min-w-0 flex-2">
          {renderLabel ? renderLabel(`${namePrefix}.strasse`, "Straße") : <Label className={FIELD_LABEL}>Straße</Label>}
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.strasse`]}</FieldError>
        </TextField>
        <TextField
          isRequired
          name={`${namePrefix}.hausnummer`}
          aria-describedby={describedById}
          value={value.hausnummer}
          onChange={(next) => updateField("hausnummer", next)}
          onBlur={() => onFieldLeft?.([`${namePrefix}.hausnummer`])}
          maxLength={ADDRESS_HAUSNUMMER_MAX_LENGTH}
          isInvalid={errors?.[`${namePrefix}.hausnummer`] ? true : undefined}
          className="min-w-0 flex-1">
          {renderLabel ? renderLabel(`${namePrefix}.hausnummer`, "Nr.") : <Label className={FIELD_LABEL}>Nr.</Label>}
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.hausnummer`]}</FieldError>
        </TextField>
      </div>

      <div className="flex gap-3">
        <TextField
          isRequired
          name={`${namePrefix}.plz`}
          aria-describedby={describedById}
          value={value.plz}
          onChange={(next) => updateField("plz", next)}
          onBlur={() => onFieldLeft?.([`${namePrefix}.plz`])}
          isInvalid={errors?.[`${namePrefix}.plz`] ? true : undefined}
          className="min-w-0 flex-1">
          {renderLabel ? renderLabel(`${namePrefix}.plz`, "PLZ") : <Label className={FIELD_LABEL}>PLZ</Label>}
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.plz`]}</FieldError>
        </TextField>
        <TextField
          isRequired
          name={`${namePrefix}.stadt`}
          aria-describedby={describedById}
          value={value.stadt}
          onChange={(next) => updateField("stadt", next)}
          onBlur={() => onFieldLeft?.([`${namePrefix}.stadt`])}
          maxLength={ADDRESS_STADT_MAX_LENGTH}
          isInvalid={errors?.[`${namePrefix}.stadt`] ? true : undefined}
          className="min-w-0 flex-2">
          {renderLabel ? renderLabel(`${namePrefix}.stadt`, "Stadt") : <Label className={FIELD_LABEL}>Stadt</Label>}
          <Input className={FIELD_INPUT} />
          <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.stadt`]}</FieldError>
        </TextField>
      </div>

      <TextField
        isRequired={isStadtteilRequired}
        name={`${namePrefix}.stadtteil`}
        aria-describedby={describedById}
        value={value.stadtteil}
        onChange={(next) => updateField("stadtteil", next)}
        onBlur={() => onFieldLeft?.([`${namePrefix}.stadtteil`])}
        maxLength={ADDRESS_STADTTEIL_MAX_LENGTH}
        isInvalid={errors?.[`${namePrefix}.stadtteil`] ? true : undefined}>
        {renderLabel ? renderLabel(`${namePrefix}.stadtteil`, "Stadtteil") : <Label className={FIELD_LABEL}>Stadtteil</Label>}
        <Input
          placeholder="z.B. Nordend"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.[`${namePrefix}.stadtteil`]}</FieldError>
      </TextField>
    </div>
  );
}
