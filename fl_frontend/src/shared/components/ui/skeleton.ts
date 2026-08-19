import { tv } from "tailwind-variants";

/**
 * The classes rather than HeroUI's `<Skeleton>`, which is `"use client"` and would pull React onto a subtree whose whole
 * job is to be thrown away. **Do not nest one inside another**: HeroUI then blends one sweep across the parent instead.
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
