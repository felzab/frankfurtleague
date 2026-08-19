"use client";

import { useId } from "react";

import { FieldError, Input, TextField, ToggleButton, ToggleButtonGroup } from "@heroui/react";

import { STUFE_OPTIONS } from "@/features/spieler/constants";
import { FIELD_ERROR } from "@/shared/components/ui/formFieldStyles";

import type { FLSpielerStufe } from "@/features/spieler/schemas";
import type { Key } from "@heroui/react";

/**
 * One level's chip. A chosen level takes the brand fill under its paired foreground, an unchosen one a
 * transparent background behind the app's ordinary border — the same filled-against-outlined pair
 * `formButtons.ts :: formButton` gives `submit` and `cancel` (decided 2026-08-12). Both states are the same
 * box — same border width, same height, same radius — so picking a level moves nothing in the row.
 *
 * **The unchosen label recedes rather than taking `cancel`'s `text-foreground`.** The fill is the weaker
 * signal in the dark theme — `globals.css` measures this maroon at 1.88:1 on that theme's `--bg-surface`,
 * where `--fg-muted` and `--fg-on-brand` stand 2.52:1 apart — so the label carries the difference there.
 * Colour is not the only carrier either way — one state has a fill the other has not — and react-aria puts
 * the same distinction on the button as `aria-pressed`.
 *
 * **Neither state changes under hover or press, and a `data-hovered:` variant does not belong here** — a
 * hover fill would be a third appearance competing with both. HeroUI's own hover and press fills are
 * `@layer components` and these classes are utilities, and `globals.css` declares utilities last, so each
 * state's resting background is the whole of what suppresses them.
 *
 * **A selected chip's FOCUS RING takes the fill's paired foreground rather than `--focus`** (WCAG 1.4.11):
 * HeroUI pins this group's ring INSET with a zero offset, so the ring is judged against the maroon it sits
 * on rather than against the surface, and `--focus` fails that in the light theme, where it is near-black.
 * `globals.css` records that departure, and the condition that produced it, where `--focus` is declared.
 * The selected chip keeps its border for the geometry above and an inset ring is drawn within it, so a
 * focused selected chip reads fill, ring, a hairline of fill again, then the surface behind.
 *
 * Used once, here. A second picker wanting this appearance is when it earns a shared constant.
 */
const STUFE_CHIP =
  "border-border bg-transparent text-foreground-muted " +
  "data-[selected=true]:border-brand-solid data-[selected=true]:bg-brand-solid data-[selected=true]:text-brand-solid-foreground " +
  "data-[selected=true]:ring-brand-solid-foreground " +
  "fluid-xs h-9 min-w-16 rounded-lg border px-3 font-extrabold tracking-wide transition-colors";

/**
 * Which of the league's six school levels a season runs — `rules.erlaubte_stufen`.
 *
 * **A segmented group rather than a multi-select, and the reason is the question it answers.** Six
 * options with a natural order, all of them visible at once: what the admin needs to see is which
 * levels are in and which are out, and a closed picker reading „E1, E2, Q1“ hides the three that are
 * not. `ThemeSwitch` is the same control in single-selection mode, which is where this pattern comes
 * from in this app.
 *
 * A picked control, so the caller judges it on CHANGE rather than on blur: a selection is
 * complete the moment it is made.
 *
 * **The group is wrapped in a `TextField` whose input never appears, and that proxy is what makes the
 * refusal land.** `ToggleButtonGroup` takes no `name`: react-aria's `AriaToggleButtonGroupProps` is
 * `ToggleGroupProps` plus labelling, so the group joins no field context, contributes no form element,
 * and `form.reportValidity()` cannot see it. On its own that leaves an empty set showing its message on
 * screen while the same submit raises the "this form does not show it" toast. The proxy carries `name`, so
 * `FormValidationContext` resolves `serverErrors[name]` onto it, `useFormValidation` writes the message
 * through `setCustomValidity`, and `reportValidity()` answers `false` the way it does for every other
 * field. It is `display: none` rather than clipped because nothing should be able to land in it —
 * react-aria's own `HiddenSelect` hides its large-collection proxy exactly this way.
 *
 * **No `disallowEmptySelection`.** Emptying the set is a state the admin can reach and the schema
 * refuses on save, which is better than a control that silently declines to deselect and leaves
 * somebody pressing a button that does nothing.
 */
export function StufenPicker({
  value,
  onChange,
  name,
}: {
  value: readonly FLSpielerStufe[];
  onChange: (next: FLSpielerStufe[]) => void;
  /** The field's path in the enclosing payload, so `Form`'s `validationErrors` reach it by name. */
  name: string;
}) {
  const errorId = useId();

  return (
    <TextField
      name={name}
      aria-label="Erlaubte Stufen"
      // The chosen levels as one string, so the proxy submits what the group holds. Read by nothing:
      // the payload is built from the caller's own state, and this field is never typed into.
      value={value.join(",")}
      onChange={() => undefined}
      className="flex w-full flex-col gap-y-1">
      {({ isInvalid }) => (
        <>
          <ToggleButtonGroup
            aria-label="Erlaubte Stufen"
            aria-describedby={isInvalid ? errorId : undefined}
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
