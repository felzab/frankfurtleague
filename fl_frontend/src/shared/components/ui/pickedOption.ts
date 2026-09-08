/**
 * A picked row's fill, HeroUI shipping an empty selected block. Spelled once so a facet's options and
 * the bar's read-order rows cannot mark a current row two ways. Tinted off `--accent-brand-solid`,
 * never `--accent-brand`, which flips per theme.
 */
export const PICKED_OPTION =
  "data-[selected=true]:bg-brand-solid/20 data-[selected=true]:text-foreground data-[selected=true]:data-hovered:bg-brand-solid/30 data-[selected=true]:data-hovered:text-foreground";
