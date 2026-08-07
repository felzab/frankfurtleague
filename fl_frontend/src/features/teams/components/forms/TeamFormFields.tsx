"use client";

import { FieldError, Input, Label, TextField } from "@heroui/react";

import { AddressFields } from "@/shared/components/ui/AddressFields";
import { FIELD_ERROR, FIELD_INPUT, FIELD_LABEL } from "@/shared/components/ui/formFieldStyles";

import type { FLPostTeamPayload } from "@/features/teams/schemas";
import type { FieldErrors } from "@/shared/utils/validation";

/**
 * The club's own fields, shared by the create modal and the Stammdaten panel of the team page.
 *
 * Field names match their path in the create/patch payload, so react-aria's `Form` distributes
 * `validationErrors` to them by name — see `SchiedsrichterFormFields`.
 *
 * `onFieldLeft` is the page half of ADR-0050: the panel judges a typed field when it is left, so it
 * passes the paths to refresh. The create modal judges on submit like its two siblings and passes
 * nothing — a blur handler that does nothing is exactly the dialog behaviour.
 */
export function TeamFormFields<T extends FLPostTeamPayload>({
  draft,
  onChange,
  errors,
  onFieldLeft,
}: {
  draft: T;
  onChange: (updatedDraft: T) => void;
  /** Server messages keyed by payload path — see `SpielortFormFields` for when this is passed. */
  errors?: FieldErrors;
  /** Called with the payload paths of a control the user just left (ADR-0050). */
  onFieldLeft?: (paths: readonly string[]) => void;
}) {
  return (
    <>
      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TextField
          isRequired
          name="name"
          value={draft.name}
          onChange={(next) => onChange({ ...draft, name: next })}
          onBlur={() => onFieldLeft?.(["name"])}
          // See `SchiedsrichterFormFields` for why the value lives on the field, not the input.
          isInvalid={errors?.["name"] ? true : undefined}>
          <Label className={FIELD_LABEL}>Name</Label>
          <Input
            placeholder="z.B. FC Frankfurt"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR}>{errors?.["name"]}</FieldError>
        </TextField>

        <TextField
          isRequired
          name="shorthand"
          value={draft.shorthand}
          onChange={(next) => onChange({ ...draft, shorthand: next })}
          onBlur={() => onFieldLeft?.(["shorthand"])}
          maxLength={2}
          isInvalid={errors?.["shorthand"] ? true : undefined}>
          <Label className={FIELD_LABEL}>Kürzel</Label>
          <Input
            placeholder="z.B. FF"
            className={FIELD_INPUT}
          />
          <FieldError className={FIELD_ERROR}>{errors?.["shorthand"]}</FieldError>
        </TextField>
      </div>

      <TextField
        isRequired
        name="full_name"
        value={draft.full_name}
        onChange={(next) => onChange({ ...draft, full_name: next })}
        onBlur={() => onFieldLeft?.(["full_name"])}
        isInvalid={errors?.["full_name"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Vollständiger Name</Label>
        <Input
          placeholder="z.B. Fußballclub Frankfurt von 2026 e.V."
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["full_name"]}</FieldError>
      </TextField>

      <TextField
        name="website_url"
        value={draft.website_url}
        onChange={(next) => onChange({ ...draft, website_url: next })}
        onBlur={() => onFieldLeft?.(["website_url"])}
        isInvalid={errors?.["website_url"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Website</Label>
        <Input
          placeholder="https://..."
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["website_url"]}</FieldError>
      </TextField>

      {/* A plain text field, not a textarea: the descriptions in the data are one to two sentences,
          and the public page renders them as a single paragraph either way. */}
      <TextField
        name="description"
        value={draft.description}
        onChange={(next) => onChange({ ...draft, description: next })}
        onBlur={() => onFieldLeft?.(["description"])}
        isInvalid={errors?.["description"] ? true : undefined}>
        <Label className={FIELD_LABEL}>Beschreibung</Label>
        <Input
          placeholder="Öffentlich sichtbarer Kurztext über die Mannschaft"
          className={FIELD_INPUT}
        />
        <FieldError className={FIELD_ERROR}>{errors?.["description"]}</FieldError>
      </TextField>

      <AddressFields
        value={draft.address}
        onChange={(newAddress) => onChange({ ...draft, address: newAddress })}
        errors={errors}
        onFieldLeft={onFieldLeft}
      />
    </>
  );
}
