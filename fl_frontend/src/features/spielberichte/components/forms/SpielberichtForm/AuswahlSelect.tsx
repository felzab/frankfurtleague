"use client";

import { FieldError } from "@heroui/react/field-error";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";

import { FIELD_ERROR_CLASSES, FIELD_LABEL_CLASSES, FIELD_TRIGGER_CLASSES } from "@/shared/components/ui/formFieldStyles";
import { Hint } from "@/shared/components/ui/Hint";
import { overlayPanel } from "@/shared/components/ui/overlayPanel";
import { listboxRow } from "@/shared/components/ui/refusableOption";
import { Select } from "@/shared/components/ui/Select";

import type { Key } from "@heroui/react/rac";
import type { ReactNode } from "react";

export type Auswahl<T extends string> = { readonly id: T; readonly label: string };

/**
 * A closed set picked by label, judged on change. Nothing is pre-selected: a seeded member would file a choice
 * nobody made.
 */
export function AuswahlSelect<T extends string>({
  name,
  label,
  placeholder,
  value,
  options,
  onChange,
  error,
  ownLabel,
  isRequired,
  hint,
}: {
  /** The payload path, so a refusal reaches the field by name. */
  name: string;
  label: string;
  placeholder: string;
  value: T | null;
  options: readonly Auswahl<T>[];
  onChange: (next: T) => void;
  error: string | undefined;
  /** A marker-carrying label rendered in place of the plain one. */
  ownLabel?: ReactNode;
  /** A mark a rule outside the leaf owes, which the caller names; absent, the schema's own decides. */
  isRequired?: boolean;
  /**
   * Why the picker offers what it does, as its description. Passed from the first render, empty while nothing applies:
   * a description mounting later is never named in the trigger's `aria-describedby`.
   */
  hint?: string;
}) {
  const item = listboxRow();
  const picked = options.find((option) => option.id === value);

  // A key outside this collection can only be a stale render, and dropping it keeps the pick the reader made.
  const handleChange = (key: Key | null) => {
    const next = options.find((option) => option.id === key?.toString());
    if (next !== undefined) onChange(next.id);
  };

  return (
    <Select
      name={name}
      // `null` and never `undefined` for no pick: react-stately reads `undefined` as uncontrolled.
      value={value}
      onChange={handleChange}
      isInvalid={error === undefined ? undefined : true}
      isRequired={isRequired}
      className="flex w-full flex-col gap-y-1">
      {ownLabel ?? <Label className={FIELD_LABEL_CLASSES}>{label}</Label>}
      <Select.Trigger className={`${FIELD_TRIGGER_CLASSES} w-full justify-between`}>
        {/* From the prop rather than `Select.Value`, which can lag a render behind and show HeroUI's English placeholder. */}
        <span className={`min-w-0 truncate ${picked === undefined ? "text-foreground-muted" : ""}`}>{picked?.label ?? placeholder}</span>
        <Select.Indicator className="shrink-0 text-foreground-muted opacity-70" />
      </Select.Trigger>
      <Select.Popover className={`${overlayPanel()} mt-2 max-h-72 overflow-y-auto p-1.5`}>
        <ListBox aria-label={label}>
          {options.map((option) => (
            <ListBox.Item
              key={option.id}
              id={option.id}
              textValue={option.label}
              className={item.row()}>
              <span className="min-w-0 truncate">{option.label}</span>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      <FieldError className={FIELD_ERROR_CLASSES}>{error}</FieldError>
      {hint !== undefined && (
        <Hint
          mode="field"
          text={hint}
        />
      )}
    </Select>
  );
}
