"use client";

import Xmark from "@gravity-ui/icons/Xmark";

import { BrandLink } from "../../ui/BrandLink";

/**
 * The drawer overlays the bar, so while it is open the bar's toggle is behind it — hence the close control here, and
 * the brand the bar drops below `lg`. It takes the bar's height, sitting exactly where the row it covers was.
 */
export function SidemenuDrawerHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-(--navbar-height) shrink-0 items-center justify-between border-b border-border px-4 lg:hidden">
      {/* Closes the drawer as it navigates, for the reason `SidemenuFooter`'s link to the same page gives. */}
      <BrandLink
        title="Zur öffentlichen Website"
        onNavigate={onClose}
      />

      <button
        onClick={onClose}
        className="-mr-1 shrink-0 rounded-md p-1.5 text-foreground-muted transition-colors hover:bg-hover hover:text-foreground"
        aria-label="Menü schließen">
        <Xmark
          className="size-5"
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
