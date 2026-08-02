/**
 * SHARED · button recipes
 *
 * Two families, deliberately kept apart (owner decision, 2026-07-31): `formButton` for controls inside
 * a form, `ctaButton` for links and one-off buttons outside one. Restyling forms must never silently
 * restyle the marketing pages, and the form base's `disabled:` handling is dead weight on a link.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Interaction state lives in a family's `base`, never at a call site — that is what keeps one
 *     gesture from acquiring several magnitudes across the app.
 *   • Transition properties are named individually. `transition-all` is not used here: the
 *     reduced-motion escape is declared once in `globals.css` and depends on knowing what moves.
 *   • Opaque fills carry their paired `-solid-foreground`, never `text-foreground`. `--fg-base` flips
 *     between themes and the fills do not, so a theme-flipping foreground on a fixed fill can only be
 *     legible in one of the two.
 */

import { tv } from "tailwind-variants";

/**
 * The CTA family — `<Link>`s and one-off buttons OUTSIDE forms: the landing-page hero, the
 * error/404 panels, dashboard not-found. Deliberately a separate recipe from `formButton` (owner
 * decision, 2026-07-31): restyling forms must never silently restyle the marketing pages, and the
 * form base's disabled styling is dead weight on a link. One recipe is what keeps the nine call
 * sites agreeing on height and hover feedback.
 */
export const ctaButton = tv({
  base: "fluid-sm hover:scale-hover flex h-12 items-center justify-center rounded-xl px-6 font-bold transition-[transform,background-color,border-color] duration-200 active:scale-95",
  variants: {
    intent: {
      primary: "bg-brand-solid hover:bg-brand-solid/90 text-brand-solid-foreground shadow-md",
      outline: "border-border text-foreground hover:bg-muted/40 border bg-transparent",
    },
    /** The hero's two secondary CTAs, deliberately smaller than the primary pair beside them. */
    size: { sm: "fluid-xs h-10 px-4" },
  },
  defaultVariants: { intent: "primary" },
});

export const formButton = tv({
  base: "fluid-sm hover:scale-hover rounded-xl px-6 py-3 font-semibold transition-[transform,color,background-color,border-color,opacity,box-shadow] duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    intent: {
      submit: "bg-brand-solid text-brand-solid-foreground tracking-wide",
      cancel: "border-border text-foreground border bg-transparent",
      // `-solid` + its paired foreground, the same pairing every other opaque feedback fill uses.
      // `bg-danger` is a tint colour: under `text-foreground` it measured 4.10:1 in the light theme
      // and 3.76:1 in the dark one, because `--fg-base` flips between themes while the fill does not.
      // This pair holds one value in both themes and measures 6.47:1 (owner, 2026-08-01, closing the
      // decision this line was waiting on).
      destructive: "bg-danger-solid text-danger-solid-foreground shadow-danger/25 tracking-wide shadow-lg",
      /** The "Neuen X anlegen" page-header buttons — taller to match the search bar beside them. */
      trigger: "bg-brand-solid text-brand-solid-foreground shadow-brand/25 h-12 font-bold shadow-lg lg:h-15",
    },
    /** For forms whose submit is the only control — the sign-in tabs have no "Abbrechen" beside it. */
    fullWidth: { true: "flex w-full items-center justify-center" },
  },
  defaultVariants: { intent: "submit" },
});
