"use client";

import { FieldError } from "@heroui/react/field-error";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";

import { Select } from "@/shared/components/ui/Select";

import { FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES, FIELD_TRIGGER_CLASSES } from "./formFieldStyles";
import { overlayPanel } from "./overlayPanel";
import { listboxRow } from "./refusableOption";

import type { Key } from "@heroui/react/rac";

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
  const item = listboxRow({ layout: "plain" });

  const handleChange = (key: Key | null) => {
    if (!key) return;
    onChange(key.toString());
  };

  return (
    <Select
      name="saison_id"
      value={value}
      onChange={handleChange}
      className="w-full">
      <Label className={FIELD_LABEL_CLASSES}>Saison</Label>
      <Select.Trigger className={`${FIELD_TRIGGER_CLASSES} w-full justify-between`}>
        <span>Saison {value}</span>
        <Select.Indicator className="shrink-0 text-foreground-muted opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR_CLASSES} />
      <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
        <ListBox aria-label="Verfügbare Saisons">
          {saisonIds.map((saisonId) => (
            <ListBox.Item
              key={saisonId}
              id={saisonId}
              textValue={`Saison ${saisonId}`}
              className={item.row()}>
              Saison {saisonId}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
