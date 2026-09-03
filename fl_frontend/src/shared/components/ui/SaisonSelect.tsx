"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "./formFieldStyles";
import { overlayPanel } from "./overlayPanel";

import type { Key } from "@heroui/react";

/**
 * The season a create form writes. Distinct from `SaisonSelector`, which navigates: a pick here changes a draft
 * and nothing else.
 */
export function SaisonSelect({
  value,
  onChange,
  saisonIds,
}: {
  value: string;
  onChange: (saisonId: string) => void;
  saisonIds: readonly string[];
}) {
  const handleChange = (key: Key | null) => {
    if (!key) return;
    onChange(key.toString());
  };

  return (
    // A literal, and this note outside the tag: `fl_frontend/src/core/schemaGerman.test.ts :: requiredNamesIn`
    // reads the mark off the tag's own text, where `isRequired={…}` or a `>` would drop every schema
    // asserted to refuse an empty `saison_id`, and the gate would stay green.
    <Select
      isRequired
      name="saison_id"
      aria-label="Saison"
      value={value}
      onChange={handleChange}
      className="w-full">
      <Label className={FIELD_LABEL}>Saison</Label>
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        <span>Saison {value}</span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR} />
      <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
        <ListBox aria-label="Verfügbare Saisons">
          {saisonIds.map((saisonId) => (
            <ListBox.Item
              key={saisonId}
              id={saisonId}
              textValue={`Saison ${saisonId}`}
              className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              Saison {saisonId}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
