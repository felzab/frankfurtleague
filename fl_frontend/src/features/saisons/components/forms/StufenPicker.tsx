"use client";

import { useId } from "react";

import { FieldError, Input, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { FIELD_ERROR, TOGGLE_GROUP_ALIGN } from "@/shared/components/ui/formFieldStyles";

import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { Key } from "@heroui/react";

/**
 * The one toggle-chip appearance in this feature, shared with the Spielplan panel's operation picker.
 *
 * **No hover or press variant here**: HeroUI's own fills are `@layer components` and these
 * are utilities declared last, so each state's resting background is what suppresses them.
 * `globals.css` records the focus ring's departure from `--focus`.
 */
export const STUFE_CHIP =
  "border-border bg-transparent text-foreground-muted " +
  "data-[selected=true]:border-brand-solid data-[selected=true]:bg-brand-solid data-[selected=true]:text-brand-solid-foreground " +
  "data-[selected=true]:ring-brand-solid-foreground " +
  "fluid-xs h-9 min-w-16 rounded-lg border px-3 font-extrabold tracking-wide transition-colors";

/**
 * `rules.erlaubte_stufen`. **The hidden `TextField` proxy is what makes a refusal land**:
 * `ToggleButtonGroup` takes no `name`, so it joins no field context and `form.reportValidity()` cannot
 * see the group. `display: none`, so nothing can land in it.
 */
export function StufenPicker({
  value,
  onChange,
  name,
  labelledBy,
}: {
  value: readonly FLSpielerStufe[];
  onChange: (next: FLSpielerStufe[]) => void;
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name: string;
  /** The id of the heading above the chips, which is what the group is named by. */
  labelledBy: string;
}) {
  const errorId = useId();

  return (
    <TextField
      name={name}
      // The proxy's own label and not the group's: `useLabel` warns without one, and this container
      // carries no role, so nothing announces it beside the heading naming the chips.
      aria-label="Erlaubte Stufen"
      // The proxy submits what the group holds. Read by nothing: the payload comes from the caller's
      // own state, and this field is never typed into.
      value={value.join(",")}
      onChange={() => undefined}
      className="flex w-full flex-col gap-y-1">
      {({ isInvalid }) => (
        <>
          {/* Named from the heading rather than by a wrapper: react-aria already renders `role="toolbar"`
              here, so a second grouping element around it would nest one group in another and leave the
              chips with two accessible names. */}
          <ToggleButtonGroup
            aria-labelledby={labelledBy}
            aria-describedby={isInvalid ? errorId : undefined}
            size="sm"
            isDetached
            // `disallowEmptySelection` would leave a press doing nothing: the empty set is reachable
            // here, and the schema refuses it on save.
            selectionMode="multiple"
            selectedKeys={value}
            // Filtered back through `STUFE_OPTIONS`, so the array is always in sequence and two compare
            // without sorting — which is what lets the change list ignore a level pressed off and on.
            onSelectionChange={(keys: Set<Key>) => {
              const picked = new Set([...keys].map(String));
              onChange(STUFE_OPTIONS.filter((stufe) => picked.has(stufe)));
            }}
            className={`flex w-full flex-row flex-wrap gap-2 ${TOGGLE_GROUP_ALIGN}`}>
            {STUFE_OPTIONS.map((stufe) => (
              <ToggleButton
                key={stufe}
                id={stufe}
                className={STUFE_CHIP}>
                {stufe}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Input className="hidden" />
          <FieldError
            id={errorId}
            className={FIELD_ERROR}
          />
        </>
      )}
    </TextField>
  );
}
