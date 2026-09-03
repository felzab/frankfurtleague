"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLGruppenNames } from "@/features/teams/schemas";
import type { GruppeOffer } from "@/features/teams/types";
import type { Key } from "@heroui/react";

/**
 * Judged on CHANGE rather than on blur — a selection is complete the moment it is made.
 *
 * A full group stays visible and DISABLED, so the admin sees why it cannot be picked.
 * `REQ-ENTER-002/003` stays the authoritative check.
 */
export function GruppeSelect({
  value,
  onChange,
  offer,
  name = "gruppe",
  error,
  withOwnLabel = true,
  isRequired = false,
}: {
  value: FLGruppenNames | null;
  onChange: (gruppe: FLGruppenNames) => void;
  /** The season's groups with occupancy, from `buildGruppeOffer` — the caller names the season. */
  offer: readonly GruppeOffer[];
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name?: string;
  /**
   * A message this caller owns, shown over anything `Form`'s `validationErrors` hold for `name` — for
   * a caller with no `<Form>`, and for the entry control whose write is not the form's.
   */
  error?: string;
  /** Off for the caller whose label is a marker-carrying `FieldLabel` rendered outside. */
  withOwnLabel?: boolean;
  /**
   * Refuse an empty pick, and let the browser say so, for the same reason
   * `fl_frontend/src/features/spieler/components/forms/TeamSelect.tsx :: TeamSelect` takes one.
   */
  isRequired?: boolean;
}) {
  const handleChange = (key: Key | null) => {
    if (!key) return;
    onChange(key.toString() as FLGruppenNames);
  };

  return (
    <Select
      isRequired={isRequired}
      name={name}
      aria-label="Gruppe"
      value={value ?? undefined}
      onChange={handleChange}
      isInvalid={error ? true : undefined}
      className="w-full">
      {withOwnLabel && <Label className={FIELD_LABEL}>Gruppe</Label>}
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would then
            show HeroUI's English placeholder. */}
        <span className={value ? "" : "text-foreground-muted"}>{value ? `Gruppe ${value}` : "Gruppe wählen"}</span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR}>{error}</FieldError>
      <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
        <ListBox aria-label="Verfügbare Gruppen">
          {offer.map(({ gruppe, occupied, capacity }) => {
            const isFull = occupied >= capacity;
            return (
              <ListBox.Item
                key={gruppe}
                id={gruppe}
                textValue={`Gruppe ${gruppe}`}
                isDisabled={isFull}
                className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200 data-disabled:cursor-not-allowed data-disabled:opacity-40">
                Gruppe {gruppe}
                {/* The fill state, always: it answers "why is that one disabled" and "how much room
                    is left" at once. */}
                <span className="fluid-xs text-foreground-muted font-semibold">{isFull ? "voll" : `${occupied}/${capacity}`}</span>
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
