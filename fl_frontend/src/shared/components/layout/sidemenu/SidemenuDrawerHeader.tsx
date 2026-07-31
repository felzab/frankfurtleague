"use client";

import { Xmark } from "@gravity-ui/icons";

import { BrandLink } from "../../ui/BrandLink";

/**
 * The drawer's own header bar. Lifted out of `Sidemenu.tsx`, where it was inlined inside a 154-line
 * client component that also owns route matching, query-string composition and two pieces of
 * open/collapse state — which is why its divergence from the other two `h-14` bars went unnoticed
 * (R4 §10.3). All three now live in files named after the header.
 */
export function SidemenuDrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="border-border flex h-14 shrink-0 items-center justify-between border-b px-4 lg:hidden">
      {/* One `BrandLink`, where this used to be a `size-8` logo stuffed into a `h-7 w-7` brand-coloured
          box — it overflowed its own container — with the wordmark as a sibling outside the link. */}
      <BrandLink />
      <button
        onClick={onClose}
        className="text-foreground-muted hover:bg-muted hover:text-foreground -mr-1 rounded-md p-1.5 transition-colors"
        aria-label="Menü schließen">
        <Xmark
          aria-hidden="true"
          width={20}
          height={20}
        />
      </button>
    </div>
  );
}
