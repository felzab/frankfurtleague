import { tv } from "tailwind-variants";

/**
 * The shell every band in the slot wears — the application band, the landing page's contact band and
 * the Instagram invitation. Its own module, importing no query, so a client component can read it.
 */
export const band = tv({
  slots: {
    root: "relative flex w-full flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl border border-border bg-surface px-4 py-4 shadow-xs sm:px-6 lg:flex-row lg:items-center lg:py-5",
    text: "fluid-sm font-bold text-foreground",
    // `bg-brand`, which flips: the solid fill sinks into the band's dark surface.
    dot: "min-h-2 min-w-2 animate-pulse rounded-full bg-brand",
    saison: "font-extrabold text-brand",
  },
});
