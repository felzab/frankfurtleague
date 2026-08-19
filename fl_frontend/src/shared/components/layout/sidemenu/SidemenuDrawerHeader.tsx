"use client";

import { Xmark } from "@gravity-ui/icons";

import { BrandLink } from "../../ui/BrandLink";

/**
 * The drawer overlays the bar, so while it is open the bar's toggle is behind it — hence the close control here, and
 * the brand the bar drops below `lg`. It takes the bar's height, sitting exactly where the row it covers was.
 */
export function SidemenuDrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="border-border flex h-(--navbar-height) shrink-0 items-center justify-between border-b px-4 lg:hidden">
      {/* Closes the drawer as it navigates, for the reason `SidemenuFooter`'s link to the same page gives. */}
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
