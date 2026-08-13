"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { Key } from "@heroui/react";

/**
 * The picker behind Position and Stufe — two closed sets with identical shape (ADR-0048).
 *
 * A picked control, so it is judged on CHANGE rather than on blur (ADR-0040): a selection is complete
 * the moment it is made, and there is no half-entered value to be wrong about.
 *
 * **Clearing is an option in the list, not a separate control.** Both fields are genuinely optional —
 * a squad is filled in over time — so "Keine Angabe" is the first entry and selects null. Without it
 * a value picked by accident could not be taken back, which is the state the eight normalised strays
 * came from: somebody typed `?` because the field could not be left empty in the sheet they copied.
 *
 * One generic component rather than two siblings: the two differ only in their option list and their
 * labels, and `GruppeSelect` stays separate because its options carry occupancy the trigger renders.
 */
export function ClosedSetSelect<TValue extends string>({
  value,
  onChange,
  options,
  name,
  label,
  placeholder,
  error,
  withOwnLabel = true,
}: {
  value: TValue | null;
  onChange: (next: TValue | null) => void;
  options: readonly TValue[];
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name: string;
  label: string;
  placeholder: string;
  /** The message for a caller without a `<Form>` context — the same split as `GruppeSelect`. */
  error?: string;
  /** Off for the caller whose label is a marker-carrying `SpielerFieldLabel` rendered outside. */
  withOwnLabel?: boolean;
}) {
  // A sentinel rather than an empty string: HeroUI treats `""` as "no selection" and the item would
  // never report as picked, so clearing would silently do nothing.
  const NONE = "__none__";

  const handleChange = (key: Key | null) => {
    if (!key) return;
    onChange(key.toString() === NONE ? null : (key.toString() as TValue));
  };

  return (
    <Select
      name={name}
      aria-label={label}
      value={value ?? NONE}
      onChange={handleChange}
      isInvalid={error ? true : undefined}
      className="w-full">
      {withOwnLabel && <Label className={FIELD_LABEL}>{label}</Label>}
      <Select.Trigger className={`${FIELD_TRIGGER} w-full justify-between`}>
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would show
            HeroUI's English placeholder. Same reasoning as `SaisonSelector`'s trigger. */}
        <span className={value ? "" : "text-foreground-muted"}>{value ?? placeholder}</span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <FieldError className={FIELD_ERROR}>{error}</FieldError>
      <Select.Popover className={`${overlayPanel()} mt-2 p-1.5`}>
        <ListBox aria-label={label}>
          <ListBox.Item
            key={NONE}
            id={NONE}
            textValue={placeholder}
            className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm border-border/50 flex flex-row items-center rounded-lg border-b px-3 py-2.5 font-bold transition-colors duration-200">
            Keine Angabe
          </ListBox.Item>
          {options.map((option) => (
            <ListBox.Item
              key={option}
              id={option}
              textValue={option}
              className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center rounded-lg px-3 py-2.5 font-bold transition-colors duration-200">
              {option}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
