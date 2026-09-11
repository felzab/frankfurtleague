/**
 * A picked row's fill, HeroUI shipping an empty selected block. Spelled once so a facet's options and
 * the bar's read-order rows cannot mark a current row two ways. Never a tint here
 * (`docs/frontend/spec.md :: I162`).
 */
export const PICKED_OPTION =
  "data-[selected=true]:bg-picked data-[selected=true]:text-foreground data-[selected=true]:data-hovered:bg-picked-hover data-[selected=true]:data-hovered:text-foreground";
