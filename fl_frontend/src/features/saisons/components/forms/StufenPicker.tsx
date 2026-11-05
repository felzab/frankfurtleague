// Session 6: goes with the old team editor's invite section, its last importer.

// **No hover or press variant here**: HeroUI's own fills are `@layer components` and these are
// utilities declared last, so each state's resting background is what suppresses them.

// The selected ring is not `--focus`: it sits inset on the selected chip's own fill
// (`fl_frontend/src/app/schemes/2027.css :: --focus`).
/** The one toggle-chip appearance, shared with every operation picker that arms one write out of two. */
export const STUFE_CHIP_CLASSES =
  "h-9 min-w-16 rounded-lg border border-border bg-transparent px-3 fluid-xs font-extrabold tracking-wide text-foreground-muted transition-colors data-[selected=true]:border-brand-solid data-[selected=true]:bg-brand-solid data-[selected=true]:text-brand-solid-foreground data-[selected=true]:ring-brand-solid-foreground";
