"use client";

import { useId } from "react";

import { Check } from "@gravity-ui/icons";

import { ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { FIELD_ERROR } from "@/shared/components/ui/formFieldStyles";

import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { Key } from "@heroui/react";

/**
 * One level's chip, in the tab strip's selected language (`formFieldStyles.ts :: TAB_ITEM`) rather than
 * HeroUI's own: untouched, `--accent-soft` over `--default` separates the two states by about three points
 * of lightness in the light theme and puts the SELECTED chip twelve points DARKER than an unselected one in
 * the dark theme, where the picker reads inverted.
 *
 * **Hover LIFTS an unselected chip to `bg-surface` instead of darkening it**, the tab strip's rule and for
 * its reason: the chip at rest is already the recessed `bg-muted`, and a darkening hover is invisible on it.
 * A selected chip keeps its fill and brightens its border, so a control already at full strength answers the
 * pointer without a second background competing with the fill.
 *
 * Local to this file rather than shared: one call site, and `TAB_ITEM` is where the shared version would
 * belong if a second picker ever wants it.
 */
const STUFE_CHIP =
  "border-border bg-muted text-foreground-muted data-hovered:bg-surface data-hovered:text-foreground " +
  "data-[selected=true]:border-brand-solid data-[selected=true]:bg-brand-solid data-[selected=true]:text-brand-solid-foreground " +
  "data-[selected=true]:data-hovered:bg-brand-solid data-[selected=true]:data-hovered:border-foreground " +
  "fluid-xs h-9 min-w-16 gap-x-1 rounded-lg border px-3 font-extrabold tracking-wide transition-colors";

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
 *
 * **Two signals separate the states, never colour alone (WCAG 1.4.1):** the fill `STUFE_CHIP` carries,
 * and a check glyph rendered in every chip and revealed only in a chosen one — reserving its box is what
 * stops six chips reflowing as the set is picked.
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
        {STUFE_OPTIONS.map((stufe) => {
          // Read from the prop rather than from a render function: the selection is already here, and a
          // plain boolean keeps the glyph's condition typed and greppable.
          const isPicked = value.includes(stufe);

          return (
            <ToggleButton
              key={stufe}
              id={stufe}
              className={STUFE_CHIP}>
              {/* Decorative in both states — react-aria announces the selection on the button itself, so a
                  labelled glyph would say it twice. */}
              <Check
                aria-hidden="true"
                className={`size-3.5 shrink-0 ${isPicked ? "opacity-100" : "opacity-0"}`}
              />
              {stufe}
            </ToggleButton>
          );
        })}
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
