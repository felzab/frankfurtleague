/** The type step the dot is sized against: an ornament outweighing the word beside it reads as a second mark. */
export type LaufendDotStep = "xxs" | "xs";

// `bg-brand` and never the solid fill, which sinks into this tint in the dark theme
// (`docs/frontend/spec.md` §1.17). Rests visible under `prefers-reduced-motion`, which stops the
// animation: `animate-ping`'s first frame is full opacity, unscaled.
const DOT = "bg-brand animate-ping rounded-full";

const DOT_SIZE: Record<LaufendDotStep, string> = { xxs: "size-1.5", xs: "size-2" };

// The step is required as a pill's tone is: one left off emits no class, and a dot with no size is
// a dot nobody sees (`fl_frontend/src/shared/components/ui/badges.ts :: labelBadge`).
/** The mark a running season wears on both surfaces, so its grade is spelled once. */
export function laufendDot(step: LaufendDotStep): string {
  return `${DOT} ${DOT_SIZE[step]}`;
}
