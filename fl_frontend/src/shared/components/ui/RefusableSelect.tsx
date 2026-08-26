"use client";

import { Label, ListBox, Select } from "@heroui/react";

import { FIELD_LABEL, FIELD_TRIGGER } from "./formFieldStyles";
import { overlayPanel } from "./overlayPanel";
import { pickIfOffered } from "./refusableOption";

import type { Key } from "@heroui/react";
import type { RefusableOption } from "./refusableOption";

/** Re-exported: a panel imports the option shape from the picker it hands the options to. */
export type { RefusableOption };

/**
 * A select whose refused rows stay VISIBLE and disabled rather than disappearing, each carrying its
 * reason where its `meta` would stand — `GruppeSelect`'s rule for a full group: a reader should see
 * why, not wonder where an expected row went.
 */
export function RefusableSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
  isDisabled,
  className,
}: {
  label: string;
  /**
   * The empty trigger's own label, and never a field's ghost text: this control accepts no typing, so it reads
   * `Team wählen` as the app's other closed pickers do. A `z.B. …` example offers a name there is nothing to type into.
   */
  placeholder: string;
  value: RefusableOption | null;
  options: readonly RefusableOption[];
  onChange: (id: string) => void;
  isDisabled: boolean;
  /** Any width the parent grid owns. The field is `w-full` without one. */
  className?: string;
}) {
  const handleChange = (key: Key | null) => {
    // The whole decision is `pickIfOffered`'s, where a unit test can reach it: this component cannot
    // be rendered by the test runner, and the re-read of `refusal` is the only guard left.
    const offered = pickIfOffered(options, key?.toString() ?? null);
    if (offered !== null) onChange(offered);
  };

  return (
    <Select
      aria-label={label}
      value={value?.id ?? undefined}
      onChange={handleChange}
      isDisabled={isDisabled}
      className={`w-full ${className ?? ""}`}>
      {/* HeroUI's own `Label`, not a bare span: it wires `for`/`id` onto the trigger, which an
          `aria-label` alone leaves unlabelled for anything reading the DOM rather than the a11y tree. */}
      <Label className={FIELD_LABEL}>{label}</Label>
      <Select.Trigger className={`${FIELD_TRIGGER} mt-1.5 w-full justify-between`}>
        {/* From the prop rather than `Select.Value`, which can lag a render behind and would show
            HeroUI's English placeholder — `GruppeSelect`'s reason, and `SaisonSelector`'s. */}
        <span className={value ? "" : "text-foreground-muted"}>
          {value === null ? placeholder : value.meta === null ? value.name : `${value.name} (${value.meta})`}
        </span>
        <Select.Indicator className="text-foreground-muted shrink-0 opacity-70" />
      </Select.Trigger>
      <Select.Popover className={`${overlayPanel()} mt-2 max-h-72 overflow-y-auto p-1.5`}>
        <ListBox aria-label={label}>
          {options.map((option) => {
            const note = option.refusal ?? option.meta;
            return (
              <ListBox.Item
                key={option.id}
                id={option.id}
                textValue={option.name}
                isDisabled={option.refusal !== null}
                className="text-foreground-muted data-hovered:bg-hover data-hovered:text-brand fluid-sm flex flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2.5 font-bold transition-colors duration-(--motion-base) data-disabled:cursor-not-allowed data-disabled:opacity-40">
                <span className="min-w-0 truncate">{option.name}</span>
                {note !== null && <span className="fluid-xs text-foreground-muted shrink-0 font-semibold">{note}</span>}
              </ListBox.Item>
            );
          })}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
