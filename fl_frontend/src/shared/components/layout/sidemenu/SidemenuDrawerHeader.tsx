"use client";

import { Xmark } from "@gravity-ui/icons";

import { BrandLink } from "../../ui/BrandLink";

/**
 * The drawer's own header, on the phone only.
 *
 * **The drawer overlays the bar rather than opening beneath it** (my call), so while it is open the
 * bar's toggle is behind it — which is why the close control lives here, at the drawer's own right
 * edge, and why this row carries the brand: below `lg` the bar shows no mark at all, and the full
 * logo and wordmark belong on the panel that covers it.
 *
 * `h-(--navbar-height)` with a bottom border, so this row sits exactly where the bar it is covering
 * was.
 */
export function SidemenuDrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="border-border flex h-(--navbar-height) shrink-0 items-center justify-between border-b px-4 lg:hidden">
      {/* Closes the drawer as it navigates: this leaves the shell exactly as `SidemenuFooter`'s link
          to the same page does, and the reason is written there. */}
      <BrandLink
        title="Zur öffentlichen Website"
        onNavigate={onClose}
      />

      <button
        onClick={onClose}
        className="text-foreground-muted hover:bg-hover hover:text-foreground -mr-1 shrink-0 rounded-md p-1.5 transition-colors"
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
