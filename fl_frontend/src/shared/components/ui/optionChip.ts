/**
 * The one chip a detached `ToggleButtonGroup` offers its answers as, spelled once so two groups on one
 * page cannot read as two different questions.
 */
// `bg-transparent` and the explicit selected arm are load-bearing: HeroUI paints `.toggle-button` a
// layered fill from `@layer components`, which a utility background alone loses to.
export const OPTION_CHIP_CLASSES =
  "h-9 rounded-lg border border-border bg-transparent px-4 fluid-xs font-extrabold tracking-wide text-foreground-muted transition-colors data-[selected=true]:border-brand-solid data-[selected=true]:bg-brand-solid data-[selected=true]:text-brand-solid-foreground data-[selected=true]:ring-brand-solid-foreground";
