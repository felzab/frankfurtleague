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
 * - **The hover arm follows the host**: `data-hovered:` on a HeroUI `Button`, `hover:` on a
 *   `next/link`. `ctaButton` below carries the reasoning; `core/dismissControl.ts` and
 *   `RowActions.tsx` split on the same rule.
 * - A transition list names exactly what a state changes, and says `scale`, never `transform` — v4
 *   emits `scale-*` as the standalone `scale` property, so a `transform` list interpolates nothing
 *   and the press snaps. The `transition-transform` shorthand is safe: v4 expands it to all four.
 * - Opaque fills carry `-solid-foreground`, never `text-foreground` — `--fg-base` flips between
 *   themes and the fills do not.
 */

import { tv } from "tailwind-variants";

const ctaButtonStyle = tv({
  base: "fluid-sm flex h-12 items-center justify-center rounded-xl px-6 font-bold transition-[scale,background-color] duration-(--motion-base) active:scale-95",
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
 * The CTA family — `<Link>`s and one-off buttons OUTSIDE forms: the landing-page hero, the
 * error/404 panels, dashboard not-found. The form base's disabled styling is dead weight on a link,
 * and one recipe is what keeps every call site agreeing on height and hover feedback.
 *
 * **`hover` is required, and it is the one thing here a call site must decide.** A HeroUI `Button` is
 * `react-aria-components/Button`, whose `useHover` discards a touch-originated pointer and writes
 * `data-hovered`; a `next/link` writes no such attribute and needs the CSS pseudo-class. Getting it
 * wrong on a `Button` costs a hybrid device — Tailwind v4 guards `hover:` with
 * `@media (hover: hover)`, which a touchscreen laptop matches, so `:hover` latches after a tap and
 * the fill stays until the user taps elsewhere.
 *
 * **Required rather than defaulted**, unlike `core/dismissControl.ts`: this family is mounted on both
 * hosts in comparable numbers, so a default would be a guess that is silently wrong at whichever
 * sites it missed. A wrapper rather than the bare `tv`, because `tv` types every variant optional and
 * omitting this one has to be a type error.
 */
export function ctaButton(options: {
  intent?: "primary" | "outline";
  size?: "sm";
  /** `"aria"` on a HeroUI `Button`, `"css"` on a `next/link` or a plain `<a>`. */
  hover: "aria" | "css";
}): string {
  return ctaButtonStyle(options);
}

/**
 * The form family. **Every intent declares a hover fill, and that is not optional here**: the four
 * controls this recipe renders — Speichern, Abbrechen, Löschen and "Neuen … anlegen" — are the most
 * pressed in the app, and a family whose only answer to the pointer is the press would leave them
 * responding to nothing at all until the button is already down.
 *
 * **One arm, unlike `ctaButton`**, because every call site mounts this on a HeroUI `Button` — which
 * is what a form control is here, and what makes `data-hovered:` the only selector this family needs.
 */
export const formButton = tv({
  base: "fluid-sm rounded-xl px-6 py-3 font-semibold transition-[scale,background-color,opacity] duration-(--motion-base) active:scale-95 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    intent: {
      submit: "bg-brand-solid data-hovered:bg-brand-solid-hover text-brand-solid-foreground tracking-wide",
      cancel: "border-border text-foreground data-hovered:bg-hover border bg-transparent",
      // `-solid` plus its paired foreground, the pairing every opaque feedback fill uses. `bg-danger`
      // is a tint: under `text-foreground` it measures 4.10:1 light and 3.76:1 dark, while this pair
      // measures 6.47:1 in both (decided 2026-08-01).
      destructive: "bg-danger-solid data-hovered:bg-danger-solid-hover text-danger-solid-foreground shadow-danger/25 tracking-wide shadow-lg",
      /** The "Neuen X anlegen" page-header buttons. The height MIRRORS `SearchBar`'s group
       * (`h-12 lg:h-15`) at every breakpoint — the two share the CRUD header row, and one growing
       * without the other is the reported mismatch. Below `sm` the trigger is the bare
       * plus continuing the search bar (decided 2026-08-07): its left corners flatten onto the
       * bar's right edge, and each modal hides its label text at that width. */
      trigger:
        "bg-brand-solid data-hovered:bg-brand-solid-hover text-brand-solid-foreground flex h-12 shrink-0 items-center justify-center gap-x-2 font-bold shadow-sm max-sm:rounded-l-none max-sm:px-4 lg:h-15",
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
