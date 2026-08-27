"use client";

import { Label, ListBox, Select } from "@heroui/react";

import { TRIKOT_FARBE_OPTIONS, trikotFarbeHex, trikotFarbeLabel } from "@/features/teams/constants";
import { FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { FLTrikotFarbe } from "@/features/teams/schemas";
import type { Key } from "@heroui/react";

/** The picker's key for the answer the field spells as `null`, a listbox having no empty item. */
const KEINE_FARBE = "keine";

/**
 * A ring rather than a filled disc, so Weiß reads as a colour on a light page instead of as a gap.
 * The fill is the league's CI hex, which no theme token tracks.
 */
function Swatch({ farbe }: { farbe: FLTrikotFarbe }) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: trikotFarbeHex(farbe) }}
      className="border-border size-4 shrink-0 rounded-full border shadow-sm"
    />
  );
}

/**
 * The season's kit colour for one club. Judged on CHANGE rather than on blur — a selection is
 * complete the moment it is made. Sixteen colours, in the CI document's order.
 */
export function TrikotFarbeSelect({
  value,
  onChange,
  name = "trikot_farbe",
  withOwnLabel = true,
}: {
  value: FLTrikotFarbe | null;
  onChange: (farbe: FLTrikotFarbe | null) => void;
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name?: string;
  /** Off for the caller whose label is a marker-carrying `FieldLabel` rendered outside. */
  withOwnLabel?: boolean;
}) {
  const handleChange = (key: Key | null) => {
    if (key === null) return;
    onChange(key.toString() === KEINE_FARBE ? null : (key.toString() as FLTrikotFarbe));
  };

  return (
    <Select
      name={name}
      aria-label="Trikotfarbe"
      value={value ?? KEINE_FARBE}
      onChange={handleChange}
      className="w-full">
      {withOwnLabel && <Label className={FIELD_LABEL}>Trikotfarbe</Label>}
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would then
            show HeroUI's English placeholder. */}
        <span className="flex min-w-0 flex-row items-center gap-x-2">
          {value !== null && <Swatch farbe={value} />}
          <span className={value ? "truncate" : "text-foreground-muted truncate"}>{value ? trikotFarbeLabel(value) : "Keine Angabe"}</span>
        </span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <Select.Popover className={`${overlayPanel()} mt-2 max-h-80 overflow-y-auto p-1.5`}>
        <ListBox aria-label="Trikotfarben">
          <ListBox.Item
            id={KEINE_FARBE}
            textValue="Keine Angabe"
            className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
            Keine Angabe
          </ListBox.Item>
          {TRIKOT_FARBE_OPTIONS.map((option) => (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
              className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              <Swatch farbe={option.value} />
              {option.label}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
