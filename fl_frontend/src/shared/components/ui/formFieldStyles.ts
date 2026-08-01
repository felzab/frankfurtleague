/**
 * The one text-field appearance. The style existed in two drifting copies across 12
 * fields: the four `AddressFields` had a brand-coloured focus border and the seven others had no
 * focus feedback at all — inside a single form, so a keyboard user saw the ring appear on
 * Straße/Nr./PLZ/Stadt and vanish on Name.
 *
 * Carries no focus classes at all. The border-turns-brand treatment and the ring suppression that
 * goes with it are declared once for every field-shaped control in the unlayered block at the bottom
 * of `globals.css`, keyed off HeroUI's `data-slot` attributes. Repeating them here is how the app
 * ended up with fields that had the treatment and fields that did not — the Tore inputs, the date
 * and time pickers and the sign-in inputs were all still showing a ring.
 *
 * `transition-colors` stays, so the border animates into brand rather than snapping.
 */
/**
 * The one form-label appearance. The app had drifted to two sizes INSIDE the same modals — the
 * entity forms' main fields at `fluid-sm` while their currency fields, the address grid and every
 * match-form section sat at `fluid-xs` (audit, 2026-07-31). `fluid-xs` over a `fluid-sm` input is
 * the Stripe/Linear convention: the value stays dominant. The sign-in form's uppercase-tracked
 * label is that page's deliberate style and not this constant.
 */
export const FIELD_LABEL = "text-fluid-xs text-foreground font-bold";

export const FIELD_INPUT = "border-border bg-surface text-foreground text-fluid-sm rounded-lg border px-3 py-2 transition-colors outline-none";

/**
 * The one tab appearance. Both tab strips in the app — the sign-in role picker and the spielplan's
 * Spieltag bar — are the same control doing the same job, and writing the classes at each site is
 * how they ended up with different hover states.
 *
 * The selected tab is excluded from the hover background on purpose: it already carries
 * `Tabs.Indicator`, and a second background under a moving indicator reads as a glitch.
 *
 * Hover LIFTS to `bg-surface` rather than darkening, because the track itself is the recessed
 * `bg-muted` (see `TAB_TRACK`). A darkening hover is invisible on a `bg-muted` track, which is
 * exactly how the two strips came to look different despite sharing this constant.
 *
 * `data-hovered:`, not `hover:` — these are react-aria components, and `useHover` ignores the
 * emulated mouse events a touch device fires, so `data-hovered` clears after a tap where `:hover`
 * sticks until the user taps something else.
 */
export const TAB_ITEM =
  "text-foreground-muted data-hovered:bg-surface data-hovered:text-foreground data-[selected=true]:text-brand-solid-foreground data-[selected=true]:data-hovered:bg-transparent data-[selected=true]:data-hovered:text-brand-solid-foreground text-fluid-sm rounded-lg font-bold tracking-wide transition-colors";

/** The recessed track both tab strips sit in. Paired with `TAB_ITEM`'s lifting hover. */
export const TAB_TRACK = "border-border bg-muted rounded-xl border";

/**
 * The selected-tab fill. `rounded-lg` is not decoration: HeroUI's `.tabs__indicator` defaults to
 * `calc(var(--radius) * 3)`, which does not match the `rounded-lg` on `TAB_ITEM` — so the hover
 * background and the selected background had visibly different corners on the same tab.
 */
export const TAB_INDICATOR = "bg-brand-solid rounded-lg shadow-sm";

/**
 * The one field-error appearance. Every `<FieldError>` in the app uses it, so a rejected value looks
 * the same wherever it is rejected — five of the six forms previously had no field-level error
 * surface at all and reported failures only through a toast that named no field.
 */
export const FIELD_ERROR = "text-fluid-xxs text-danger mt-1 font-bold";

/**
 * Section label inside a form. Groups of fields are named with a heading and separated by
 * whitespace/rules rather than wrapped in bordered panels — nesting bordered boxes inside an
 * already-bordered modal reads as a layered cake and, per WAI form guidance, deep grouping hurts
 * comprehension more than it helps.
 *
 * Only for groups whose members are heterogeneous ("Termin" = date + time). A group whose first
 * field label already names it (Spielort, Schiedsrichter) gets no heading — that would render the
 * same word twice and read it twice to a screen reader.
 */
export const FORM_SECTION_HEADING = "text-fluid-xs text-foreground font-bold tracking-wider uppercase";
