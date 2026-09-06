import { tv } from "tailwind-variants";

/**
 * The shell every band in the slot wears — the application band, the landing page's contact band and
 * the Instagram invitation. Its own module, importing no query, so a client component can read it.
 */
export const band = tv({
  slots: {
    root: "border-border bg-surface relative flex w-full flex-col items-start justify-between gap-4 overflow-hidden rounded-2xl border px-4 py-4 shadow-xs sm:px-6 lg:flex-row lg:items-center lg:py-5",
    text: "fluid-sm text-foreground font-bold",
    // `bg-brand`, which flips: the solid fill sinks into the band's dark surface.
    dot: "bg-brand min-h-2 min-w-2 animate-pulse rounded-full",
    saison: "text-brand font-extrabold",
  },
});
