/**
 * The radius the recipes below carry, and the one every `Chip` in this app sets in place of HeroUI's. On a `Chip` it
 * overrides `rounded-2xl` from `.chip`, and a utility beats the component layer, so no `!` is needed.
 */
export const PILL_RADIUS = "rounded-md";

/**
 * A number in a pill; `min-w-6` so single digits are not ovals. Colour stays the caller's, but the brand pair is
 * `bg-brand-solid` with its own foreground, never an alpha on `brand`, which flips per theme.
 */
export const COUNT_BADGE = `fluid-xxs inline-flex min-w-6 items-center justify-center ${PILL_RADIUS} px-1.5 py-0.5 font-extrabold`;

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

export const PILL_TINT: Record<PillTone, string> = {
  success: "bg-success/15 text-success-strong",
  warning: "bg-warning/15 text-warning-strong",
  danger: "bg-danger/15 text-danger-strong",
  info: "bg-info/15 text-info-strong",
  // `text-brand` and never the solid fill as ink: that fill does not flip per theme, so on this tint
  // it measures 1.30:1 in the dark one.
  brand: "bg-brand/10 text-brand",
  // A badge of office rather than a grade. `fl_frontend/src/features/spieler/shorthandChip.ts` draws
  // the phone layout's twin of the one chip wearing it, so the two boxes have to match.
  brandSolid: "bg-brand-solid text-brand-solid-foreground",
  // `/10` where the feedback tints take `/15`: at `/15` the tightest light-theme phase pair falls
  // under 4.5:1 on `--bg-surface`.
  gruppenphase: "bg-phase-gruppenphase/10 text-phase-gruppenphase",
  achtelfinale: "bg-phase-achtelfinale/10 text-phase-achtelfinale",
  viertelfinale: "bg-phase-viertelfinale/10 text-phase-viertelfinale",
  halbfinale: "bg-phase-halbfinale/10 text-phase-halbfinale",
  finale: "bg-phase-finale/10 text-phase-finale",
};

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
