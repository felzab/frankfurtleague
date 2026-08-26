"use client";

import { FieldError, Input, Label, TextArea, TextField } from "@heroui/react";

import { WebsiteUrlField } from "@/features/teams/components/forms/WebsiteUrlField";
import { DESCRIPTION_MAX_LENGTH } from "@/features/teams/constants";
import { AddressFields } from "@/shared/components/ui/AddressFields";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";

import type { FLPostTeamPayload } from "@/features/teams/schemas";
import type { FieldErrors } from "@/shared/utils/validation";

/**
 * Field names match their path in the create payload, so react-aria's `Form` distributes
 * `validationErrors` to them by name.
 */
export function TeamFormFields<T extends FLPostTeamPayload>({
  draft,
  onChange,
  errors,
}: {
  draft: T;
  onChange: (updatedDraft: T) => void;
  /** Server messages keyed by payload path — see `SpielortFormFields` for when this is passed. */
  errors?: FieldErrors;
}) {
  return (
    <>
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TextField
          isRequired
          name="name"
          value={draft.name}
          onChange={(next) => onChange({ ...draft, name: next })}
          // See `SchiedsrichterFormFields` for why the value lives on the field, not the input.
          isInvalid={errors?.["name"] ? true : undefined}>
          <Label className={FIELD_LABEL}>Name</Label>
          <Input
            placeholder="z.B. Goethe-Gymnasium"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR}>{errors?.["name"]}</FieldError>
        </TextField>

        <TextField
          isRequired
          name="shorthand"
          // Uppercased at the boundary: the shorthand is unique across every club, so stored and
          // typed must not differ by case alone.
          value={draft.shorthand}
          onChange={(next) => onChange({ ...draft, shorthand: next.toUpperCase() })}
          maxLength={2}
          isInvalid={errors?.["shorthand"] ? true : undefined}>
          <Label className={FIELD_LABEL}>Kürzel</Label>
          <Input className={`${FIELD_INPUT} font-extrabold tracking-widest uppercase`} />
          <FieldError className={FIELD_ERROR}>{errors?.["shorthand"]}</FieldError>
        </TextField>
      </div>

      <TextField
        isRequired
        name="full_name"
        value={draft.full_name}
        onChange={(next) => onChange({ ...draft, full_name: next })}
        isInvalid={errors?.["full_name"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Vollständiger Name</Label>
        <Input
          placeholder="z.B. Johann-Wolfgang-von-Goethe-Gymnasium"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["full_name"]}</FieldError>
      </TextField>

      <WebsiteUrlField
        value={draft.website_url}
        onChange={(nextUrl) => onChange({ ...draft, website_url: nextUrl })}
        error={errors?.["website_url"]}
      />

      <TextField
        name="description"
        value={draft.description}
        onChange={(next) => onChange({ ...draft, description: next })}
        maxLength={DESCRIPTION_MAX_LENGTH}
        isInvalid={errors?.["description"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Beschreibung</Label>
        <TextArea
          fullWidth
          placeholder="z.B. Schulteam aus dem Nordend, seit 2019 in der Liga"
          className="border-border bg-surface text-foreground fluid-sm min-h-24 rounded-lg border px-3 py-2 transition-colors outline-none"
        />
        <FieldError className={FIELD_ERROR}>{errors?.["description"]}</FieldError>
      </TextField>

      <AddressFields
        value={draft.address}
        onChange={(newAddress) => onChange({ ...draft, address: newAddress })}
        errors={errors}
      />
    </>
  );
}
