"use client";

import { FieldError } from "@heroui/react/field-error";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { TextArea } from "@heroui/react/textarea";

import { WebsiteUrlField } from "@/features/teams/components/forms/WebsiteUrlField";
import {
  DESCRIPTION_MAX_LENGTH,
  TEAM_FULL_NAME_MAX_LENGTH,
  TEAM_NAME_MAX_LENGTH,
  TEAM_WEBSITE_URL_MAX_LENGTH,
  WEBSITE_URL_SCHEME,
} from "@/features/teams/constants";
import { AddressFields } from "@/shared/components/ui/AddressFields";
import { FIELD_ERROR_CLASSES, FIELD_INPUT_CLASSES, FIELD_LABEL_CLASSES, FIELD_TEXTAREA_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { TextField } from "@/shared/components/ui/TextField";

import type { FLPostTeamPayload } from "@/features/teams/schemas";

/**
 * Field names match their path in the create payload, so react-aria's `Form` distributes
 * `validationErrors` to them by name.
 */
export function TeamFormFields<T extends FLPostTeamPayload>({ draft, onChange }: { draft: T; onChange: (updatedDraft: T) => void }) {
  return (
    <>
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TextField
          name="name"
          // See `SchiedsrichterFormFields` for why the value lives on the field, not the input.
          value={draft.name}
          onChange={(next) => onChange({ ...draft, name: next })}
          maxLength={TEAM_NAME_MAX_LENGTH}>
          <Label className={FIELD_LABEL_CLASSES}>Name</Label>
          <Input
            placeholder="z.B. Goethe-Gymnasium"
            className={FIELD_INPUT_CLASSES}
          />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>

        <TextField
          name="shorthand"
          // Uppercased at the boundary: the shorthand is unique across every club, so stored and
          // typed must not differ by case alone.
          value={draft.shorthand}
          onChange={(next) => onChange({ ...draft, shorthand: next.toUpperCase() })}
          maxLength={2}>
          <Label className={FIELD_LABEL_CLASSES}>Kürzel</Label>
          <Input className={`${FIELD_INPUT_CLASSES} font-extrabold tracking-widest uppercase`} />
          <FieldError className={FIELD_ERROR_CLASSES} />
        </TextField>
      </div>

      <TextField
        name="full_name"
        value={draft.full_name}
        onChange={(next) => onChange({ ...draft, full_name: next })}
        maxLength={TEAM_FULL_NAME_MAX_LENGTH}>
        <Label className={FIELD_LABEL_CLASSES}>Vollständiger Name</Label>
        <Input
          placeholder="z.B. Johann-Wolfgang-von-Goethe-Gymnasium"
          className={FIELD_INPUT_CLASSES}
        />
        <FieldError className={FIELD_ERROR_CLASSES} />
      </TextField>

      <WebsiteUrlField
        value={draft.website_url}
        onChange={(nextUrl) => onChange({ ...draft, website_url: nextUrl })}
        // The box holds the URL without the scheme, which the group renders as furniture, so the
        // payload's ceiling is composed rather than passed whole.
        maxLength={TEAM_WEBSITE_URL_MAX_LENGTH - WEBSITE_URL_SCHEME.length}
      />

      <TextField
        name="description"
        value={draft.description}
        onChange={(next) => onChange({ ...draft, description: next })}
        maxLength={DESCRIPTION_MAX_LENGTH}>
        <Label className={FIELD_LABEL_CLASSES}>Beschreibung</Label>
        <TextArea
          fullWidth
          placeholder="z.B. Schulteam aus dem Nordend, seit 2019 in der Liga"
          className={`${FIELD_TEXTAREA_CLASSES} min-h-24`}
        />
        <FieldError className={FIELD_ERROR_CLASSES} />
      </TextField>

      <AddressFields
        value={draft.address}
        onChange={(newAddress) => onChange({ ...draft, address: newAddress })}
      />
    </>
  );
}
