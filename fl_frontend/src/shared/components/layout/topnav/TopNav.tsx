import Link from "next/link";

import { BrandLink } from "../../ui/BrandLink";
import { TopNavLinksDropdown } from "./TopNavLinksDropdown";

// Sync, and the dropdown is rendered bare: TopNavLinksDropdown is a static client component (no
// hooks that need a request, no data), so the Suspense that used to wrap it guarded nothing and
// only added a resumable slot to the PPR shell. The whole nav is part of the static shell now.
// `px-4` with no `sm:px-6`: the sidemenu's header is `px-4` at every width, so the two bars put the
// wordmark in the same place. Crossing between a public route and the dashboard used to shift it 8px
// to the left from `sm` up (NEW-R2).
export function TopNav() {
  return (
    <nav className="flex h-(--navbar-height) w-full items-center justify-between px-4">
      {/* Brand Logo Area */}
      <BrandLink />

      {/* Navigation Links Area */}
      <div className="flex items-center gap-2 sm:gap-4">
        {/* Desktop Links (Hidden on Mobile) */}
        <div className="hidden items-center gap-1 lg:flex">
          <Link
            href="/dashboard"
            className="text-fluid-sm text-foreground hover:bg-muted rounded-full px-4 py-1.5 font-semibold transition-colors">
            Saisonübersicht
          </Link>

          <Link
            href="/admin"
            className="text-fluid-sm text-foreground hover:bg-muted rounded-full px-4 py-1.5 font-semibold transition-colors">
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
