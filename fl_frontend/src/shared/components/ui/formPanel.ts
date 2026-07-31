import { tv } from "tailwind-variants";

/**
 * The admin edit-form section panel (ledger V2-7). Five sites hand-wrote this surface and gave three
 * different answers to the same padding question — `p-4`, `p-2 lg:p-4`, `p-3 lg:p-4` — which is the
 * drift a recipe exists to stop. Unified on `p-3 lg:p-4`, the majority answer and the only one that
 * scales with the breakpoint.
 *
 * A `rounded-xl` form panel is a deliberately different tier from `card()`'s `rounded-2xl` surface:
 * panels nest *inside* the admin edit modal, and matching the modal's own radius would flatten the
 * nesting visually. Kept as its own recipe rather than a `card()` variant for that reason.
 *
 * Gap is **not** in the recipe: `gap-y-2`/`gap-y-4`/`gap-y-6` track how much content each section
 * holds, so they are a caller decision, not drift.
 */
export const formPanel = tv({
  base: "bg-surface border-border flex h-fit w-full flex-col rounded-xl border p-3 shadow-sm lg:p-4",
});

/**
 * The floating counterpart — the date picker's popover and both `Autocomplete.Popover`s.
 *
 * Separate from `formPanel` on purpose: these are overlays, so they carry `shadow-lg` for elevation
 * and none of the in-flow layout (`flex h-fit w-full flex-col`). Folding them together would need a
 * variant that rewrites half the base, which is a sign they are two things, not one.
 */
export const overlayPanel = tv({
  base: "bg-surface border-border text-foreground rounded-xl border shadow-lg",
});
