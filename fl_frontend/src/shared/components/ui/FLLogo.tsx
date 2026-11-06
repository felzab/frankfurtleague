// Redesign: moves into the kit once `BrandLink`, its importer beside `kit/Brand.tsx`, goes with the old frames;
// the old-component ban's allowance for `kit/Brand.tsx` goes with it.

import { MARK_ID } from "@/core/brand";

/**
 * The `viewBox` is the drawing's own tall bounds, so a square utility such as `size-8` centres the mark in a box of
 * dead width: a caller sizes it by height instead.
 */
export function FLLogo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    // `fill-current`, so the ground decides: the navbar sits on the page and takes the dark green,
    // while the hero sits on that same green and needs the light one. A baked fill is invisible on
    // one of them. The drawing sets no fill of its own, so it takes this one through the `<use>`.
    <svg
      viewBox="184.4 46 143.2 420"
      xmlns="http://www.w3.org/2000/svg"
      className={`fill-current ${className}`}
      role="presentation">
      <use href={`#${MARK_ID}`} />
    </svg>
  );
}
