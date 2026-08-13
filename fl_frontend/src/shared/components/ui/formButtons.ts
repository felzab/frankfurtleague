/**
 * SHARED · button recipes
 *
 * Two families, deliberately kept apart (decided 2026-07-31): `formButton` for controls inside a form,
 * `ctaButton` for links and one-off buttons outside one. Restyling forms must never silently restyle the marketing pages.
 *
 * Invariants:
 * - Interaction state lives in a family's `base`, never at a call site.
 * - Hover is a declared fill token, never an alpha — the values and the one magnitude are in
 *   `globals.css`. Press keeps `active:scale-95`; nothing scales or moves on hover.
 * - **Each family takes back what `.button` decides for itself** — its height and its press, both on `formButton` below.
 * - **The hover arm follows the host**: `data-hovered:` on a HeroUI `Button`, `hover:` on a
 *   `next/link`. `ctaButton` below carries the reasoning; `core/dismissControl.ts` and
 *   `RowActions.tsx` split on the same rule.
 * - A transition list names exactly what a state changes, and says `scale`, never `transform` — v4
 *   emits `scale-*` as the standalone `scale` property, so a `transform` list interpolates nothing
 *   and the press snaps. The `transition-transform` shorthand is safe: v4 expands it to all four.
 * - Opaque fills carry `-solid-foreground`, never `text-foreground` — `--fg-base` flips between
 *   themes and the fills do not, and no fill takes a coloured shadow beside it.
 */

import { tv } from "tailwind-variants";

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
 *
 * `h-12` and `transform-none` are here for the reason they are on `formButton`, and they matter on the
 * half of this family that mounts on a HeroUI `Button`; on a `next/link` neither has anything to beat.
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
 *
 * **`h-12` is the family's box, and it is `ctaButton`'s** — so a modal's Speichern is the same height
 * as the trigger that opened it and as the landing page's own buttons. A height is not optional in
 * either family: `@heroui/styles/components/button.css` gives `.button` `h-10 md:h-9`, so a recipe
 * setting only padding ships a 36px control whose `py-*` lands inside a fixed box and adds no height
 * at all. Vertical centring comes from the flex base, as it does on `ctaButton`.
 *
 * **`transform-none` is what suppresses HeroUI's own press**, and it is the reason a disabled control
 * now answers a pointer with nothing. `.button` scales to 0.97 on `:active` AND on
 * `[data-pressed="true"]` — the second needs no pointer event, so `disabled:pointer-events-none` never
 * reached it. A `scale-*` utility cannot cancel it, because v4 emits the standalone `scale` property,
 * which composes with `transform` rather than replacing it (`lessons.md` §10); `transform-none` can,
 * because utilities outrank `@layer components`. `active:scale-95` is then the app's one press
 * magnitude, in place of the 0.9215 the two produced together at two different timings.
 *
 * **`active:scale-95` is spelled exactly that, and the spelling is load-bearing.** `globals.css`
 * escapes the press under `prefers-reduced-motion` by naming that class, unlayered, so nothing here can
 * restate it: put any variant in front of it and the escape names a class that no longer exists,
 * leaving a press that moves for the readers it exists for. `formButtons.test.ts` holds all three
 * against the compiled stylesheet, none of them being visible to a type, a lint rule or the build.
 */
export const formButton = tv({
  base: "fluid-sm flex h-12 transform-none items-center justify-center rounded-xl px-6 font-semibold transition-[scale,background-color,opacity] duration-(--motion-base) active:scale-95 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    intent: {
      submit: "bg-brand-solid data-hovered:bg-brand-solid-hover text-brand-solid-foreground",
      cancel: "border-border text-foreground data-hovered:bg-hover border bg-transparent",
      // `-solid` plus its paired foreground, the pairing every opaque feedback fill uses. `bg-danger`
      // is a tint: under `text-foreground` it measures 4.10:1 light and 3.76:1 dark, while this pair
      // measures 6.47:1 in both (decided 2026-08-01).
      //
      // The fill alone is the destructive signal, and it is enough: solid against `cancel`'s outline,
      // and a different hue from `submit`'s. The halo it used to carry was drawn in `--accent-danger`,
      // a lighter and more saturated red than the fill under it, at the largest shadow size in the app.
      destructive: "bg-danger-solid data-hovered:bg-danger-solid-hover text-danger-solid-foreground",
      /** The "Neuen X anlegen" page-header buttons. The height MIRRORS `SearchBar`'s group
       * (`h-12 lg:h-15`) at every breakpoint — the two share the CRUD header row, and one growing
       * without the other is the reported mismatch. Below `sm` the trigger is the bare
       * plus continuing the search bar (decided 2026-08-07): its left corners flatten onto the
       * bar's right edge, and each modal hides its label text at that width. */
      trigger:
        "bg-brand-solid data-hovered:bg-brand-solid-hover text-brand-solid-foreground shrink-0 gap-x-2 font-bold shadow-sm max-sm:rounded-l-none max-sm:px-4 lg:h-15",
    },
    /** For forms whose submit is the only control — the sign-in tabs have no "Abbrechen" beside it. */
    fullWidth: { true: "w-full" },
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

/**
 * The band with a symmetrical pair in it: Abbrechen beside Speichern, Abbrechen beside Übernehmen,
 * Abbrechen beside the delete confirmation's own verb.
 *
 * The flex shape belongs here rather than at each site for the reason the band itself does — five
 * footers spelling it by hand had drifted to four spellings, and the width is the one thing a site
 * must not restate (see `MODAL_FOOTER`), so the two are safest declared together.
 */
export const MODAL_FOOTER_ROW = `${MODAL_FOOTER} flex flex-row items-center justify-evenly gap-3`;

/**
 * The band for a pair that is NOT symmetrical — one of the two discards work or accepts every warning
 * listed above it. Stacked at every width: the confirmations are `ModalShell`'s narrow size, which
 * cannot seat both labels side by side, and a pair that stacks only sometimes reads as two designs.
 */
export const MODAL_FOOTER_STACK = `${MODAL_FOOTER} flex min-w-0 flex-col gap-2.5`;
