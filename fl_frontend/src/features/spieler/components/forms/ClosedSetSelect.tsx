"use client";

import { FieldError, Label, ListBox, Select } from "@heroui/react";

import { FIELD_ERROR, FIELD_LABEL, FIELD_TRIGGER } from "@/shared/components/ui/formFieldStyles";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";

import type { Key } from "@heroui/react";

/**
 * Judged on CHANGE rather than on blur — a selection is complete the moment it is made.
 *
 * **Clearing is an option in the list, not a control**: without "Keine Angabe" a value picked by
 * accident could not be taken back.
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
  // A sentinel rather than `""`: HeroUI reads `""` as "no selection", so clearing would silently do
  // nothing.
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
        {/* From the prop, not `Select.Value` — the collection can lag a render behind and would then
            show HeroUI's English placeholder. */}
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
