/**
 * The one text-field appearance (R4 §8.5). The style existed in two drifting copies across 12
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
export const FIELD_INPUT = "border-border bg-surface text-foreground text-fluid-sm rounded-lg border px-3 py-2 transition-colors outline-none";

/**
 * The one field-error appearance. Every `<FieldError>` in the app uses it, so a rejected value looks
 * the same wherever it is rejected — five of the six forms previously had no field-level error
 * surface at all and reported failures only through a toast that named no field (R4 §3.1).
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
