import { tv } from "tailwind-variants";

// A transition list says `scale`, never `transform`: v4 emits `scale-*` as the standalone `scale`
// property, so a `transform` list interpolates nothing and the press snaps.
const ctaButtonStyle = tv({
  base: "flex h-12 transform-none items-center justify-center rounded-xl px-6 fluid-sm font-bold transition-[scale,background-color] duration-(--motion-base) active:scale-95",
  variants: {
    intent: {
      primary: "bg-brand-solid text-brand-solid-foreground shadow-md",
      outline: "border border-border bg-transparent text-foreground",
    },
    /** The hero's two secondary CTAs, deliberately smaller than the primary pair beside them. */
    size: { sm: "h-10 px-4 fluid-xs" },
    /**
     * For a label the page does not write, such as a club's name, which a phone's width may not seat on
     * one line: the height becomes a floor and the label wraps, as `formButton`'s `stacks` does.
     */
    wraps: { true: "h-auto min-h-12 py-3 text-center whitespace-normal" },
    hover: { aria: "", css: "" },
  },
  // The fill is per intent and the selector is per host, so the pair decides — one flat `hover`
  // variant could carry only one of the two fills.
  compoundVariants: [
    { intent: "primary", hover: "aria", class: "data-hovered:bg-brand-solid-hover" },
    { intent: "primary", hover: "css", class: "hover:bg-brand-solid-hover" },
    { intent: "outline", hover: "aria", class: "data-hovered:bg-hover" },
    { intent: "outline", hover: "css", class: "hover:bg-hover" },
  ],
  defaultVariants: { intent: "primary" },
});

/**
 * Links and one-off buttons outside a form, kept apart so restyling forms never restyles the marketing pages. A wrapper
 * rather than the bare `tv`, which types every variant optional where omitting `hover` has to be a type error.
 */
export function ctaButton(options: {
  intent?: "primary" | "outline";
  size?: "sm";
  wraps?: boolean;
  /**
   * `"aria"` on a HeroUI `Button`, whose `useHover` discards a touch pointer; `"css"` on a `next/link`, which writes no
   * such attribute. Wrong on a `Button`, a hybrid device latches `:hover` after a tap.
   */
  hover: "aria" | "css";
}): string {
  return ctaButtonStyle(options);
}

/**
 * `h-12` and `transform-none` beat `@heroui/styles`, which fixes a height and scales on `[data-pressed]` where
 * no `scale-*` can cancel it. Neither is visible to the toolchain, so `formButtons.test.ts` asserts both.
 */
export const formButton = tv({
  // `active:scale-95` must stay spelled exactly that: `globals.css` names the class, unlayered, to escape
  // the press under `prefers-reduced-motion`, so a variant in front of it orphans that escape.
  base: "flex h-12 transform-none items-center justify-center rounded-xl px-6 fluid-sm font-semibold transition-[scale,background-color,opacity] duration-(--motion-base) active:scale-95 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    intent: {
      submit: "bg-brand-solid text-brand-solid-foreground data-hovered:bg-brand-solid-hover",
      cancel: "border border-border bg-transparent text-foreground data-hovered:bg-hover",
      /**
       * Page chrome, not the action bar's exit: a surface and a shadow where `cancel` is transparent. A recipe, not a
       * hand-spelled string, so it inherits the base — without that the vendored press scales the pill and the
       * reduced-motion escape misses it.
       */
      nav: "border border-border bg-surface px-4 fluid-xs font-bold text-foreground shadow-sm data-hovered:bg-hover",
      // `-solid` plus its paired foreground: `bg-danger` is a tint, and under `text-foreground` it falls
      // to 4.00:1 in the dark theme, where this pair clears 4.5:1 in both.
      destructive: "bg-danger-solid text-danger-solid-foreground data-hovered:bg-danger-solid-hover",
      /**
       * The CRUD header's create button. Its height mirrors `SearchBar`'s group at every breakpoint, since the
       * two share that row; below `sm` it continues the bar, with flattened left corners and its label for screen
       * readers alone.
       */
      trigger:
        "shrink-0 gap-x-2 bg-brand-solid font-bold text-brand-solid-foreground shadow-sm data-hovered:bg-brand-solid-hover max-sm:rounded-l-none max-sm:px-4 lg:h-15",
    },
    /** For forms whose submit is the only control — the sign-in tabs have no "Abbrechen" beside it. */
    fullWidth: { true: "w-full" },
    /**
     * For a control in a row that is a column below `sm`. It fills that column, and its height becomes a
     * floor: HeroUI's `white-space: nowrap` is lifted here, and `h-12` would clip the second line of a
     * label a phone's width cannot seat on one.
     */
    // `size` beside it does not shorten the control: `tv` resolves by declaration order, so `h-10` replaces
    // `h-auto` while `min-h-12` still floors the box, and the wrap is clipped. No call site pairs them.
    stacks: { true: "h-auto min-h-12 w-full py-2 text-center whitespace-normal sm:w-auto" },
    /**
     * Height alone, so page chrome stays under the action bar's — except `xs`, which takes the
     * badge's type step too: it stands in a row of `labelBadge` chips, where a taller control is
     * what makes the row read as ragged.
     */
    size: { sm: "h-10", xs: "h-7 px-3 fluid-xxs" },
  },
  defaultVariants: { intent: "submit" },
});

/**
 * The primary control of a two-press confirm. **The fill grades the press on offer**, so the armed
 * one wears `destructive` — it is the only thing that looks different once `ConfirmReveal` is open.
 */
export const confirmButton = (isConfirming: boolean): string =>
  `${formButton({ intent: isConfirming ? "destructive" : "submit", stacks: true })} flex items-center gap-x-2`;

// The distance above the band is the host column's gap, never a margin here: a margin in a shared
// constant composes with whatever gap each host declares (`docs/frontend/spec.md :: I240`).
/**
 * The numbers cancel `ModalShell`'s body inset exactly, so this is the one place that follows if it moves.
 * **A call site must not add `w-full`**: with no `twMerge` in the path, `.w-full` is emitted last and silently wins.
 */
export const MODAL_FOOTER_CLASSES = "-mx-4 w-[calc(100%+2rem)] border-t border-border px-4 pt-4";

/** The band with a symmetrical pair in it, its flex shape declared beside the width a site must not restate. */
export const MODAL_FOOTER_ROW_CLASSES = `${MODAL_FOOTER_CLASSES} flex flex-row items-center justify-evenly gap-3`;

/**
 * The band for a pair that is not symmetrical — one of the two discards work. Stacked at every width, since
 * `ModalShell`'s narrow size cannot seat both labels side by side and a sometimes-stacked pair reads as two designs.
 */
export const MODAL_FOOTER_STACK_CLASSES = `${MODAL_FOOTER_CLASSES} flex min-w-0 flex-col gap-3`;
