"use client";

export default function SidemenuMobileHeader({ displayTitle, onToggleMenu }: { displayTitle: string; onToggleMenu: () => void }) {
  return (
    <header className="bg-surface border-border flex h-14 w-full shrink-0 items-center justify-between border-b px-4 lg:hidden">
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleMenu}
          className="text-foreground hover:bg-muted -ml-2 rounded-md p-1.5 transition-colors"
          aria-label="Open Menu">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="h-6 w-6">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
            />
          </svg>
        </button>
        <span className="text-fluid-sm font-medium tracking-wide">{displayTitle}</span>
      </div>
    </header>
  );
}
