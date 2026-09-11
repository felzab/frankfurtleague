/**
 * The radius the recipes below carry, and the one every `Chip` in this app sets in place of HeroUI's. On a `Chip` it
 * overrides `rounded-2xl` from `.chip`, and a utility beats the component layer, so no `!` is needed.
 */
export const PILL_RADIUS = "rounded-md";

/**
 * A number in a pill; `min-w-6` so single digits are not ovals. Colour stays the caller's, but the brand pair is
 * `bg-brand-solid` with its own foreground, never an alpha on `brand`, which flips per theme.
 */
export const COUNT_BADGE = `font-numeric fluid-xxs inline-flex min-w-6 items-center justify-center ${PILL_RADIUS} px-1.5 py-0.5 font-extrabold tabular-nums`;

/**
 * Every tone a pill may wear, and no member of it is neutral: a grey chip reads as a control that has
 * been switched off (`docs/frontend/spec.md :: I170`).
 */
export type PillTone =
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "brand"
  | "brandSolid"
  | "gruppenphase"
  | "achtelfinale"
  | "viertelfinale"
  | "halbfinale"
  | "finale";

/**
 * Every pair below is measured on `surface` (`scripts/checks/docs_gate/scheme.py :: PAIRS`), so a
 * pill sits on `surface` or `background` alone: on any other fill its light ink composites under
 * the floor, and `PILL_SOLID` goes there instead.
 */
export const PILL_TINT: Record<PillTone, string> = {
  success: "bg-success/15 text-success-strong",
  warning: "bg-warning/15 text-warning-strong",
  danger: "bg-danger/15 text-danger-strong",
  info: "bg-info/15 text-info-strong",
  // `text-brand` and never the solid fill as ink: that fill does not flip per theme, so on this tint
  // it measures 1.18:1 in the dark one.
  brand: "bg-brand/15 text-brand",
  // A badge of office rather than a grade. `fl_frontend/src/features/spieler/shorthandChip.ts` draws
  // the phone layout's twin of the one chip wearing it, so the two boxes have to match.
  brandSolid: "bg-brand-solid text-brand-solid-foreground",
  // One alpha for every pill: a `/10` tint beside a `/15` one reads as a paler grade of the same
  // chip. The light teal and blue inks sit low enough to clear 4.5:1 here.
  gruppenphase: "bg-phase-gruppenphase/15 text-phase-gruppenphase",
  achtelfinale: "bg-phase-achtelfinale/15 text-phase-achtelfinale",
  viertelfinale: "bg-phase-viertelfinale/15 text-phase-viertelfinale",
  halbfinale: "bg-phase-halbfinale/15 text-phase-halbfinale",
  finale: "bg-phase-finale/15 text-phase-finale",
};

/** The four tones that carry a `-solid` fill. Brand's is `brandSolid`, and a phase has none. */
export type FeedbackTone = Extract<PillTone, "success" | "warning" | "danger" | "info">;

/**
 * For a ground a tint cannot survive — a tab strip's `muted`, and any fill painted under a pill:
 * the tone's fill under its paired on-colour, a pair no ground moves
 * (`docs/frontend/spec.md :: I229`).
 */
export const PILL_SOLID: Record<FeedbackTone, string> = {
  success: "bg-success-solid text-success-solid-foreground",
  warning: "bg-warning-solid text-warning-solid-foreground",
  danger: "bg-danger-solid text-danger-solid-foreground",
  info: "bg-info-solid text-info-solid-foreground",
};

/** A count on `surface` or `background`, tinted as a label pill is. */
export function countBadge(tone: PillTone): string {
  return `${COUNT_BADGE} ${PILL_TINT[tone]}`;
}

/** A count on a ground a tint's ink cannot survive: solid, under its on-colour. */
export function trackCountBadge(tone: FeedbackTone): string {
  return `${COUNT_BADGE} ${PILL_SOLID[tone]}`;
}

/**
 * A word in a pill — "Empfohlen", "Disqualifiziert", "Nicht gespeichert".
 *
 * `whitespace-nowrap` here rather than per call site: a broken pill reads as two, and a fixed-layout
 * column is where one gets narrow enough to break.
 */
const LABEL_BADGE = `fluid-xxs inline-flex items-center ${PILL_RADIUS} px-1.5 py-0.5 font-bold whitespace-nowrap`;

/**
 * The tone is a parameter rather than an optional variant, so no pill exists without one: a variant
 * left off emits no class and reports nothing.
 */
export function labelBadge(tone: PillTone): string {
  return `${LABEL_BADGE} ${PILL_TINT[tone]}`;
}

/** A word on `trackCountBadge`'s grounds, where the tint would composite with the fill under it. */
export function trackLabelBadge(tone: FeedbackTone): string {
  return `${LABEL_BADGE} ${PILL_SOLID[tone]}`;
}
