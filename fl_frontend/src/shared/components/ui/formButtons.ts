/**
 * SHARED · button recipes
 *
 * Two families, deliberately kept apart (decided 2026-07-31): `formButton` for controls inside a
 * form, `ctaButton` for links and one-off buttons outside one. Restyling forms must never
 * silently restyle the marketing pages.
 *
 * Invariants:
 * - Interaction state lives in a family's `base`, never at a call site.
 * - Hover is a declared fill token, never an alpha — the values and the one magnitude are in
 *   `globals.css`. Press keeps `active:scale-95`; nothing scales or moves on hover.
 * - A transition list names exactly what a state changes, and says `scale`, never `transform` — v4
 *   emits `scale-*` as the standalone `scale` property, so a `transform` list interpolates nothing
 *   and the press snaps. The `transition-transform` shorthand is safe: v4 expands it to all four.
 * - Opaque fills carry `-solid-foreground`, never `text-foreground` — `--fg-base` flips between
 *   themes and the fills do not.
 */

import { tv } from "tailwind-variants";

/**
 * The CTA family — `<Link>`s and one-off buttons OUTSIDE forms: the landing-page hero, the
 * error/404 panels, dashboard not-found. The form base's disabled styling is dead weight on a link,
 * and one recipe is what keeps every call site agreeing on height and hover feedback.
 */
export const ctaButton = tv({
  base: "fluid-sm flex h-12 items-center justify-center rounded-xl px-6 font-bold transition-[scale,background-color] duration-(--motion-base) active:scale-95",
  variants: {
    intent: {
      primary: "bg-brand-solid hover:bg-brand-solid-hover text-brand-solid-foreground shadow-md",
      outline: "border-border text-foreground hover:bg-hover border bg-transparent",
    },
    /** The hero's two secondary CTAs, deliberately smaller than the primary pair beside them. */
    size: { sm: "fluid-xs h-10 px-4" },
  },
  defaultVariants: { intent: "primary" },
});

/**
 * The form family. **Every intent declares a hover fill, and that is not optional here**: the four
 * controls this recipe renders — Speichern, Abbrechen, Löschen and "Neuen … anlegen" — are the most
 * pressed in the app, and a family whose only answer to the pointer is the press would leave them
 * responding to nothing at all until the button is already down.
 */
export const formButton = tv({
  base: "fluid-sm rounded-xl px-6 py-3 font-semibold transition-[scale,background-color,opacity] duration-(--motion-base) active:scale-95 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    intent: {
      submit: "bg-brand-solid hover:bg-brand-solid-hover text-brand-solid-foreground tracking-wide",
      cancel: "border-border text-foreground hover:bg-hover border bg-transparent",
      // `-solid` plus its paired foreground, the pairing every opaque feedback fill uses. `bg-danger`
      // is a tint: under `text-foreground` it measures 4.10:1 light and 3.76:1 dark, while this pair
      // measures 6.47:1 in both (decided 2026-08-01).
      destructive: "bg-danger-solid hover:bg-danger-solid-hover text-danger-solid-foreground shadow-danger/25 tracking-wide shadow-lg",
      /** The "Neuen X anlegen" page-header buttons. The height MIRRORS `SearchBar`'s group
       * (`h-12 lg:h-15`) at every breakpoint — the two share the CRUD header row, and one growing
       * without the other is the reported mismatch. Below `sm` the trigger is the bare
       * plus continuing the search bar (decided 2026-08-07): its left corners flatten onto the
       * bar's right edge, and each modal hides its label text at that width. */
      trigger:
        "bg-brand-solid hover:bg-brand-solid-hover text-brand-solid-foreground flex h-12 shrink-0 items-center justify-center gap-x-2 font-bold shadow-sm max-sm:rounded-l-none max-sm:px-4 lg:h-15",
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
 * boundary between what you fill in and what you press (decided 2026-08-07). `ModalShell` puts the
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
