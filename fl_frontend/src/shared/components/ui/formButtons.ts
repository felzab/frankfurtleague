import { tv } from "tailwind-variants";

/**
 * The submit / cancel / destructive / trigger button appearance, once (R4 §8.4, sweep rows
 * V2-1…V2-3). Six submit buttons had four appearances and five cancel buttons had two, because a
 * 7-class string was retyped at every site — which is also how the broken `hover:bg-surface-muted`
 * of R4 §6.3 got in.
 *
 * The interaction states live in the base so the whole family agrees on them:
 * - `active:scale-95` — the press state existed at 5 stray sites and nowhere in the recipe (V2-2).
 * - `disabled:pointer-events-none disabled:opacity-50` — the app had zero `disabled:` styling
 *   anywhere (V2-3); react-aria renders `isDisabled` as the native `disabled` attribute, and
 *   `pointer-events-none` also stops the hover/active transforms from firing on a disabled button.
 * - Named transition properties, not `transition-all` (V2-4).
 *
 * `destructive` keeps `text-foreground` on `bg-danger` deliberately: that pairing is a contrast
 * decision the owner still has to make, tracked as NEW-C1 in Wave 6, not something to change here.
 */
/**
 * The CTA family — `<Link>`s and one-off buttons OUTSIDE forms: the landing-page hero, the
 * error/404 panels, dashboard not-found. Deliberately a separate recipe from `formButton` (owner
 * decision, 2026-07-31): restyling forms must never silently restyle the marketing pages, and the
 * form base's disabled styling is dead weight on a link. Before this recipe the nine call sites
 * disagreed on height (h-10/11/12), hover feedback (present or absent) and carried one dead
 * `shadow-brand/30` with no shadow size to give it effect.
 */
export const ctaButton = tv({
  base: "text-fluid-sm hover:scale-hover flex h-12 items-center justify-center rounded-xl px-6 font-bold transition-[transform,background-color,border-color] duration-200 active:scale-95",
  variants: {
    intent: {
      primary: "bg-brand-solid hover:bg-brand-solid/90 text-brand-solid-foreground shadow-md",
      outline: "border-border text-foreground hover:bg-muted/40 border bg-transparent",
    },
    /** The hero's two secondary CTAs, deliberately smaller than the primary pair beside them. */
    size: { sm: "text-fluid-xs h-10 px-4" },
  },
  defaultVariants: { intent: "primary" },
});

export const formButton = tv({
  base: "text-fluid-sm hover:scale-hover rounded-xl px-6 py-3 font-semibold transition-[transform,color,background-color,border-color,opacity,box-shadow] duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    intent: {
      submit: "bg-brand-solid text-brand-solid-foreground tracking-wide",
      cancel: "border-border text-foreground border bg-transparent",
      destructive: "bg-danger text-foreground shadow-danger/25 tracking-wide shadow-lg",
      /** The "Neuen X anlegen" page-header buttons — taller to match the search bar beside them. */
      trigger: "bg-brand-solid text-brand-solid-foreground shadow-brand/25 h-12 font-bold shadow-lg lg:h-15",
    },
    /** For forms whose submit is the only control — the sign-in tabs have no "Abbrechen" beside it. */
    fullWidth: { true: "flex w-full items-center justify-center" },
  },
  defaultVariants: { intent: "submit" },
});
