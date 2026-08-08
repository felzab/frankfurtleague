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
 *   • **A named list says `scale`, never `transform`.** Tailwind v4 emits `scale-*` as the standalone
 *     `scale` property, so a list naming `transform` interpolates something that never changes and
 *     both gestures — the hover lift and the press — snap instead of easing. Nothing in the toolchain
 *     can see it: the class is valid, the property is real, and the two never meet. The
 *     `transition-transform` SHORTHAND is safe, because v4 expands it to `transform,translate,scale,
 *     rotate`; only a hand-written list has to name what actually moves.
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
  base: "fluid-sm hover:scale-hover flex h-12 items-center justify-center rounded-xl px-6 font-bold transition-[scale,background-color,border-color] duration-200 active:scale-95",
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
  base: "fluid-sm hover:scale-hover rounded-xl px-6 py-3 font-semibold transition-[scale,color,background-color,border-color,opacity,box-shadow] duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50",
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
      /** The "Neuen X anlegen" page-header buttons. The height MIRRORS `SearchBar`'s group
       * (`h-12 lg:h-15`) at every breakpoint — the two share the CRUD header row, and one growing
       * without the other is the mismatch the owner reported. Below `sm` the trigger is the bare
       * plus continuing the search bar (owner, 2026-08-07): its left corners flatten onto the
       * bar's right edge, and each modal hides its label text at that width. */
      trigger:
        "bg-brand-solid text-brand-solid-foreground flex h-12 shrink-0 items-center justify-center gap-x-2 font-bold shadow-sm max-sm:rounded-l-none max-sm:px-4 lg:h-15",
    },
    /** For forms whose submit is the only control — the sign-in tabs have no "Abbrechen" beside it. */
    fullWidth: { true: "flex w-full items-center justify-center" },
  },
  defaultVariants: { intent: "submit" },
});

/**
 * The footer band under a modal form's fields: a separator that reaches the dialog's own edges, then
 * the buttons back at the fields' inset.
 *
 * **The negative margin is the whole point and is measured against `ModalShell`.** A border drawn inside
 * the body's padding stops short of the dialog's edges and reads as a stray line rather than as the
 * boundary between what you fill in and what you press (owner, 2026-08-07). `ModalShell` puts the
 * horizontal inset on its BODY as `px-4` and zeroes HeroUI's own body margin so that 1rem is the whole
 * of it — so `-mx-4` cancels exactly that, `w-[calc(100%+2rem)]` restores the width the margin took,
 * and `px-4` puts the buttons back in line with the fields above them.
 *
 * **It carries `w-full`, and a call site must not add its own width.** Both are plain utilities on a DOM
 * `div` with no `twMerge` in the path, so both reach the class attribute and CSS source order decides —
 * `.w-full` is emitted after `.w-[calc(…)]`, so a call site adding `w-full` silently won and the footer
 * rendered 2rem narrower than its own margin, flush at the left and 2rem short at the right. That is
 * the asymmetric gap and the separator that stopped early. Declaring the width here, once, is what
 * removes the conflict rather than relying on every site to leave it out.
 *
 * A constant rather than a class string at each site, because the numbers are derived from another
 * component's padding: if `ModalShell`'s `px-4` ever moves, this is the one place that has to follow.
 */
export const MODAL_FOOTER = "border-border -mx-4 mt-2 w-[calc(100%+2rem)] border-t px-4 pt-4";
