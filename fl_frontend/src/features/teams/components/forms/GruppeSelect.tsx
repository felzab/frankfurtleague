"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLGruppenNames } from "@/features/teams/schemas";
import type { GruppeOffer } from "@/features/teams/types";
import type { Key } from "@heroui/react";

/**
 * The group picker, shared by the create form and the junction editor.
 *
 * A picked control, so it is judged on CHANGE rather than on blur (ADR-0050): a selection is
 * complete the moment it is made, and there is no half-entered value to be wrong about.
 *
 * **It offers the season's own groups, with their fill state** (owner, 2026-08-07): `offer` is the
 * season's first `number_of_groups` of the closed set, each row carrying how many of its
 * `teams_per_group` places are taken. A full group stays visible and disabled — the admin should see
 * WHY it cannot be picked rather than wonder where it went. The junction write refuses the same
 * shapes (REQ-ENTER-002/003) and stays the authoritative check.
 */
export function GruppeSelect({
  value,
  onChange,
  offer,
  name = "gruppe",
  error,
  withOwnLabel = true,
}: {
  value: FLGruppenNames | null;
  onChange: (gruppe: FLGruppenNames) => void;
  /** The season's groups with occupancy, from `buildGruppeOffer` — the caller names the season. */
  offer: readonly GruppeOffer[];
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name?: string;
  /** The message for the caller without a `<Form>` context — same split as `SpielortFormFields`. */
  error?: string;
  /** Off for the caller whose label is a marker-carrying `TeamFieldLabel` rendered outside. */
  withOwnLabel?: boolean;
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
      {withOwnLabel && <Label className={FIELD_LABEL}>Gruppe</Label>}
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would show
            HeroUI's English placeholder. Same reasoning as `SaisonSelector`'s trigger. */}
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
                className="text-foreground-muted hover:bg-muted hover:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200 data-disabled:cursor-not-allowed data-disabled:opacity-40">
                Gruppe {gruppe}
                {/* The fill state, always: "3/8" answers "why is that one disabled" and "how much
                    room is left" in the same three characters. */}
                <span className="fluid-xs text-foreground-muted font-semibold">{isFull ? "voll" : `${occupied}/${capacity}`}</span>
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
