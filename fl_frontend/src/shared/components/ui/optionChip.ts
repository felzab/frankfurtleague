/**
 * The one chip a detached `ToggleButtonGroup` offers its answers as.
 *
 * `bg-transparent` and an explicit selected arm are load-bearing: HeroUI paints `.toggle-button` a
 * layered fill from `@layer components`, which a utility background alone loses to. Spelled once so
 * two groups on one page cannot read as two different questions.
 */
export const OPTION_CHIP =
  "border-border bg-transparent text-foreground-muted " +
  "data-[selected=true]:border-brand-solid data-[selected=true]:bg-brand-solid data-[selected=true]:text-brand-solid-foreground " +
  "data-[selected=true]:ring-brand-solid-foreground " +
  "fluid-xs h-9 rounded-lg border px-4 font-extrabold tracking-wide transition-colors";
