import Link from "next/link";

import { FLLogo } from "../../ui/FLLogo";
import TopNavLinksDropdown from "./TopNavLinksDropdown";

// Sync, and the dropdown is rendered bare: TopNavLinksDropdown is a static client component (no
// hooks that need a request, no data), so the Suspense that used to wrap it guarded nothing and
// only added a resumable slot to the PPR shell. The whole nav is part of the static shell now.
export default function TopNav() {
  return (
    <nav className="flex h-(--navbar-height) w-full items-center justify-between px-4 sm:px-6">
      {/* Brand Logo Area */}
      <Link
        href="/"
        title="Startseite"
        className="text-fluid-lg text-foreground flex items-center gap-2 font-bold tracking-tighter transition-opacity hover:opacity-80">
        <FLLogo />
        Frankfurt-League
      </Link>

      {/* Navigation Links Area */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Desktop Links (Hidden on Mobile) */}
        <div className="hidden items-center gap-1 lg:flex">
          <Link
            href="/dashboard"
            className="text-fluid-sm text-foreground hover:bg-muted focus-visible:ring-brand rounded-full px-4 py-1.5 font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none">
            Saisonübersicht
          </Link>

          <Link
            href="/admin"
            className="text-fluid-sm text-foreground hover:bg-muted focus-visible:ring-brand rounded-full px-4 py-1.5 font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none">
            Verwalten
          </Link>

          {/* Semantic Divider instead of an empty hardcoded div (We use this div instead of a HeroUI Separator because of performance)*/}
          <div
            className="bg-border ml-2 h-8 w-px"
            aria-hidden="true"
          />
        </div>
        <TopNavLinksDropdown />
      </div>
    </nav>
  );
}
