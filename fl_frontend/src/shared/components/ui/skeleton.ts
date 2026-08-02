/**
 * SHARED · skeleton recipe
 *
 * The one placeholder-block appearance. See the export for why it borrows HeroUI's classes instead of
 * rendering HeroUI's `<Skeleton>`, and for the rule about nesting.
 */

import { tv } from "@/shared/utils/tv";

/**
 * A single grey placeholder block, shimmering left-to-right on HeroUI's own 2s loop.
 *
 * **Why the classes and not `<Skeleton>`.** HeroUI's component is `"use client"` and calls
 * `useCSSVariable`, which reads `--skeleton-animation` off `document.documentElement`. Rendering it
 * would pull React onto a subtree whose entire job is to be thrown away — every placeholder in this
 * app is either a `Suspense` fallback or a pre-hydration stand-in, i.e. markup that is replaced
 * before it can ever be interactive. `.skeleton` / `.skeleton--shimmer` are exactly the classes that
 * component emits, `skeleton.css` is already imported in `globals.css` (ADR-0019) — where it was
 * previously paying for nothing, because nothing rendered a `<Skeleton>` — and applying them
 * directly keeps every placeholder zero-JS.
 *
 * **Do not nest one of these inside another.** HeroUI's `.skeleton--shimmer:has(.skeleton)` rule
 * swaps the per-block sweep for a single `mix-blend-mode: overlay` sweep across the parent and
 * suppresses the children's. Every placeholder here is a leaf, and the sweeps stay in step anyway
 * because they share one duration and start together.
 *
 * The `tone` fills override HeroUI's `--surface-tertiary` so the grey comes from this app's token
 * layer and flips with the theme; they land in the utilities layer, which already outranks HeroUI's
 * `components` layer, so no `!` is needed. The sweep gradient stays HeroUI's — it is a lighter step
 * than `--bg-muted` in both themes, which is the contrast a shimmer wants. `field` exists for the
 * three meta pages, whose surfaces stay green in both themes and where `bg-muted` would read as a
 * grey hole punched in the pitch.
 *
 * Callers supply their own radius and size; the base deliberately declares neither.
 */
export const skeletonBlock = tv({
  base: "skeleton skeleton--shimmer",
  variants: {
    tone: {
      surface: "bg-muted",
      field: "bg-field-fg/15",
    },
  },
  defaultVariants: { tone: "surface" },
});
