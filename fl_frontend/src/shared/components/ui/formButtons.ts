import { tv } from "tailwind-variants";

// A transition list says `scale`, never `transform`: v4 emits `scale-*` as the standalone `scale`
// property, so a `transform` list interpolates nothing and the press snaps.
const ctaButtonStyle = tv({
  base: "fluid-sm flex h-12 transform-none items-center justify-center rounded-xl px-6 font-bold transition-[scale,background-color] duration-(--motion-base) active:scale-95",
  variants: {
    intent: {
      primary: "bg-brand-solid text-brand-solid-foreground shadow-md",
      outline: "border-border text-foreground border bg-transparent",
    },
    /** The hero's two secondary CTAs, deliberately smaller than the primary pair beside them. */
    size: { sm: "fluid-xs h-10 px-4" },
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
  base: "fluid-sm flex h-12 transform-none items-center justify-center rounded-xl px-6 font-semibold transition-[scale,background-color,opacity] duration-(--motion-base) active:scale-95 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    intent: {
      submit: "bg-brand-solid data-hovered:bg-brand-solid-hover text-brand-solid-foreground",
      cancel: "border-border text-foreground data-hovered:bg-hover border bg-transparent",
      // `-solid` plus its paired foreground: `bg-danger` is a tint, and under `text-foreground` it falls
      // below 4.5:1 in both themes, where this pair clears it in both.
      destructive: "bg-danger-solid data-hovered:bg-danger-solid-hover text-danger-solid-foreground",
      /**
       * The CRUD header's create button. Its height mirrors `SearchBar`'s group at every breakpoint, since the
       * two share that row; below `sm` it continues the bar, with flattened left corners and no label.
       */
      trigger:
        "bg-brand-solid data-hovered:bg-brand-solid-hover text-brand-solid-foreground shrink-0 gap-x-2 font-bold shadow-sm max-sm:rounded-l-none max-sm:px-4 lg:h-15",
    },
    /** For forms whose submit is the only control — the sign-in tabs have no "Abbrechen" beside it. */
    fullWidth: { true: "w-full" },
  },
  defaultVariants: { intent: "submit" },
});

/**
 * The primary control of a two-press confirm. **The fill grades the press on offer**, so the armed
 * one wears `destructive` — it is the only thing that looks different once `ConfirmReveal` is open.
 */
export const confirmButton = (isConfirming: boolean): string =>
  `${formButton({ intent: isConfirming ? "destructive" : "submit" })} flex items-center gap-x-2`;

/**
 * The numbers cancel `ModalShell`'s body inset exactly, so this is the one place that follows if it moves.
 * **A call site must not add `w-full`**: with no `twMerge` in the path, `.w-full` is emitted last and silently wins.
 */
export const MODAL_FOOTER = "border-border -mx-4 mt-2 w-[calc(100%+2rem)] border-t px-4 pt-4";

/** The band with a symmetrical pair in it, its flex shape declared beside the width a site must not restate. */
export const MODAL_FOOTER_ROW = `${MODAL_FOOTER} flex flex-row items-center justify-evenly gap-3`;

/**
 * The band for a pair that is not symmetrical — one of the two discards work. Stacked at every width, since
 * `ModalShell`'s narrow size cannot seat both labels side by side and a sometimes-stacked pair reads as two designs.
 */
export const MODAL_FOOTER_STACK = `${MODAL_FOOTER} flex min-w-0 flex-col gap-2.5`;
