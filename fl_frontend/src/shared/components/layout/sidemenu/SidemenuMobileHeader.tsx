"use client";

import { Bars } from "@gravity-ui/icons";

export function SidemenuMobileHeader({ displayTitle, onToggleMenu }: { displayTitle: string; onToggleMenu: () => void }) {
  return (
    <header className="bg-surface border-border box-content flex h-(--navbar-height) w-full shrink-0 items-center justify-between border-b px-4 lg:hidden">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMenu}
          className="text-foreground hover:bg-muted -ml-2 rounded-md p-1.5 transition-colors"
          aria-label="Menü öffnen">
          <Bars
            aria-hidden="true"
            width={24}
            height={24}
          />
        </button>
        <span className="fluid-sm font-medium tracking-wide">{displayTitle}</span>
      </div>
    </header>
  );
}
