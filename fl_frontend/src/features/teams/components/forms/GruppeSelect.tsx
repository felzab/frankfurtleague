"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { GRUPPEN_OPTIONS } from "@/features/teams/constants";
import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLGruppenNames } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

/**
 * The group picker, shared by the create form and the junction editor.
 *
 * A picked control, so it is judged on CHANGE rather than on blur (ADR-0050): a selection is
 * complete the moment it is made, and there is no half-entered value to be wrong about.
 */
export function GruppeSelect({
  value,
  onChange,
  name = "gruppe",
  error,
}: {
  value: FLGruppenNames | null;
  onChange: (gruppe: FLGruppenNames) => void;
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name?: string;
  /** The message for the caller without a `<Form>` context — same split as `SpielortFormFields`. */
  error?: string;
}) {
  const handleChange = (key: Key | null) => {
    if (!key) return;
    onChange(key.toString() as FLGruppenNames);
  };

  return (
    <Select
      name={name}
      aria-label="Gruppe"
      value={value ?? undefined}
      onChange={handleChange}
      isInvalid={error ? true : undefined}
      className="w-full">
      <Label className={FIELD_LABEL}>Gruppe</Label>
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would show
            HeroUI's English placeholder. Same reasoning as `SaisonSelector`'s trigger. */}
        <span className={value ? "" : "text-foreground-muted"}>{value ? `Gruppe ${value}` : "Gruppe wählen"}</span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR}>{error}</FieldError>
      <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
        <ListBox aria-label="Verfügbare Gruppen">
          {GRUPPEN_OPTIONS.map((gruppe) => (
            <ListBox.Item
              key={gruppe}
              id={gruppe}
              textValue={`Gruppe ${gruppe}`}
              className="text-foreground-muted hover:bg-muted hover:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              Gruppe {gruppe}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
