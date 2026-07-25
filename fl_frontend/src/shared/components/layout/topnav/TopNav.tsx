import dynamic from "next/dynamic";
import Link from "next/link";

import { Bars } from "@gravity-ui/icons";

import { FLLogo } from "../../ui/FLLogo";

const TopNavLinksDropdown = dynamic(() => import("./TopNavLinksDropdown"), {
  ssr: true,
  loading: () => (
    <Bars
      aria-label="Loading menu"
      className="text-foreground-muted size-8 opacity-50"
    />
  ),
});

export default async function TopNav() {
  return (
    <nav className="flex h-[var(--navbar-height)] w-full items-center justify-between px-4 sm:px-6">
      {/* Brand Logo Area */}
      <Link
        href="/"
        title="Homepage"
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
            className="text-fluid-sm text-foreground hover:bg-muted focus-visible:ring-action rounded-full px-4 py-1.5 font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none">
            Saisonübersicht
          </Link>

          <Link
            href="/admin"
            className="text-fluid-sm text-foreground hover:bg-muted focus-visible:ring-action rounded-full px-4 py-1.5 font-semibold transition-colors focus-visible:ring-2 focus-visible:outline-none">
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
