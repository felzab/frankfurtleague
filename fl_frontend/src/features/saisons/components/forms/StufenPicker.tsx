"use client";

import { useId } from "react";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { FIELD_ERROR } from "@/shared/components/ui/formFieldStyles";

import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { Key } from "@heroui/react";

/**
 * Which of the league's six school levels a season runs — `rules.erlaubte_stufen`.
 *
 * **A segmented group rather than a multi-select, and the reason is the question it answers.** Six
 * options with a natural order, all of them visible at once: what the admin needs to see is which
 * levels are in and which are out, and a closed picker reading „E1, E2, Q1“ hides the three that are
 * not. `ThemeSwitch` is the same control in single-selection mode, which is where this pattern comes
 * from in this app.
 *
 * A picked control, so the caller judges it on CHANGE rather than on blur (ADR-0040): a selection is
 * complete the moment it is made.
 *
 * **The message is a plain paragraph rather than a `FieldError`, because this is not a field.** A
 * toggle group is a collection, so it takes part in no react-aria field context and `Form`'s
 * `validationErrors` cannot reach it by name — the caller passes the message from the descriptor table,
 * and `aria-describedby` is what gets it announced.
 *
 * **No `disallowEmptySelection`.** Emptying the set is a state the admin can reach and the schema
 * refuses on save, which is better than a control that silently declines to deselect and leaves
 * somebody pressing a button that does nothing.
 */
export function StufenPicker({
  value,
  onChange,
  error,
}: {
  value: readonly FLSpielerStufe[];
  onChange: (next: FLSpielerStufe[]) => void;
  /** The schema's message for `rules.erlaubte_stufen`, from the caller's own error map. */
  error?: string;
}) {
  const errorId = useId();

  return (
    <div className="flex w-full flex-col gap-y-1">
      <ToggleButtonGroup
        aria-label="Erlaubte Stufen"
        aria-describedby={error ? errorId : undefined}
        size="sm"
        isDetached
        selectionMode="multiple"
        selectedKeys={value}
        // Filtered back through the league's own order (`STUFE_OPTIONS`), so the stored array is always
        // in sequence and two of them compare without sorting first — which is what lets the change
        // list treat pressing a level off and back on as no change at all.
        onSelectionChange={(keys: Set<Key>) => {
          const picked = new Set([...keys].map(String));
          onChange(STUFE_OPTIONS.filter((stufe) => picked.has(stufe)));
        }}
        className="flex w-full flex-row flex-wrap gap-2">
        {STUFE_OPTIONS.map((stufe) => (
          <ToggleButton
            key={stufe}
            id={stufe}
            className="fluid-xs h-9 min-w-14 font-extrabold tracking-wide">
            {stufe}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {error && (
        <p
          id={errorId}
          className={FIELD_ERROR}>
          {error}
        </p>
      )}
    </div>
  );
}
