import { cacheLife, cacheTag } from "next/cache";
import Image from "next/image";

import { now } from "@/core/clock";
import { COPY } from "@/core/copy/shared";
import { LEGAL_PAGES, ROUTES } from "@/core/routes";
import { SITE_CACHE_TAG } from "@/core/siteCache";

import { Brand } from "./Brand";
import { smallCaps } from "./cardStyles";
import { HeaderLinks } from "./HeaderLinks";
import { Link } from "./Link";
import { ThemeRow } from "./ThemeChoice";
import { ToastRegion } from "./Toast";
import { NavigationBar, PageContent } from "./WholePage";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { HeaderLink } from "./HeaderLinks";
import type { Sponsor } from "./TileGrid";

/** The year the © line names, read once a day rather than on every request. */
async function Year() {
  "use cache";
  cacheTag(SITE_CACHE_TAG);
  cacheLife("days");
  return COPY.template.copyright(now().getFullYear(), COPY.brand.name);
}

// The legal pages, opened rarely: a prefetch would load each one's shell on every page the footer stands on, so their
// links load nothing ahead, and a press on one waits a server round trip, as the site holds no `loading.tsx`.
const UNPREFETCHED: ReadonlySet<string> = new Set(LEGAL_PAGES.map((page) => ROUTES[page].path()));

function FooterGroup({ heading, links }: { heading: Copy; links: ReadonlyArray<HeaderLink> }) {
  return (
    <nav
      aria-label={heading}
      // `justify-items-start`: a grid stretches each link to the column, so the row's empty end would take the pointer.
      className="grid content-start justify-items-start gap-1">
      <h2 className={smallCaps({ class: "mb-2" })}>{heading}</h2>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          placement="footer"
          label={link.label}
          prefetch={UNPREFETCHED.has(link.href) ? false : undefined}
        />
      ))}
    </nav>
  );
}

/**
 * The classic public frame: the band with the logo, its links and „Konto“, the way to the sign-in, at the top, and the
 * footer at the foot. Each page's template writes its title and its content through `ClassicPage` and `ClassicTitle`.
 */
export function ClassicFrame({
  links,
  signIn,
  saison,
  liga,
  legal,
  social,
  sponsors,
  children,
}: {
  links: ReadonlyArray<HeaderLink>;
  signIn: Route;
  saison: ReadonlyArray<HeaderLink>;
  liga: ReadonlyArray<HeaderLink>;
  legal: ReadonlyArray<HeaderLink>;
  social: { instagram: string; threads: string };
  sponsors: ReadonlyArray<Sponsor>;
  children: ReactNode;
}) {
  return (
    // Marked, so the root's scroll padding clears the band: the browser scrolls the focus and a fragment's place below it.
    <div
      data-kit-frame="classic"
      className="flex min-h-dvh flex-col">
      {/* A picture of its own in a page's cross-fade, so the page scrolled under it is not drawn over it (`tokens.css`). */}
      <header className="sticky top-0 z-20 shrink-0 bg-brand-solid px-4 text-on-brand [--focus-ring:var(--on-brand)] [view-transition-name:band] lg:px-8">
        <div className="@container mx-auto flex h-(--classic-header) w-full max-w-classic items-center gap-2 lg:gap-8">
          <Brand ground="band" />
          <HeaderLinks
            links={links}
            signIn={signIn}
          />
        </div>
      </header>
      <NavigationBar placement="classic" />

      <PageContent>{children}</PageContent>

      <footer className="shrink-0 border-t border-border bg-bg px-4 lg:px-8">
        <div className="mx-auto grid w-full max-w-classic gap-6 py-6 lg:py-8">
          <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
            <div className="grid content-start justify-items-start gap-2">
              <Brand ground="page" />
              <p className="text-sm text-fg-muted">{COPY.template.oberstufenliga}</p>
              {/* The glyphs the question door draws, so the networks read the same on every page. */}
              <div className="flex gap-2">
                <Link
                  href={social.instagram}
                  placement="icon"
                  icon="instagram"
                  label={COPY.template.instagram}
                />
                <Link
                  href={social.threads}
                  placement="icon"
                  icon="threads"
                  label={COPY.template.threads}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-3">
              <FooterGroup
                heading={COPY.shared.saison}
                links={saison}
              />
              <FooterGroup
                heading={COPY.template.liga}
                links={liga}
              />
              <FooterGroup
                heading={COPY.template.legal}
                links={legal}
              />
            </div>
          </div>
          {sponsors.length > 0 && (
            <div className="grid gap-2">
              <p className="text-xs text-fg-muted">{COPY.template.supportedBy}</p>
              <div className="flex flex-wrap items-center gap-6">
                {sponsors.map((sponsor) => (
                  <Link
                    key={sponsor.href}
                    href={sponsor.href}
                    placement="footer"
                    sponsored>
                    <span
                      title={sponsor.name.record}
                      className="flex items-center gap-2 text-xs">
                      <span className="relative block h-6 w-24">
                        <Image
                          src={sponsor.logo}
                          alt={sponsor.name.record}
                          fill
                          sizes="6rem"
                          className="object-contain object-left grayscale"
                        />
                      </span>
                      {sponsor.short !== undefined && <span aria-hidden>{sponsor.short.record}</span>}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {/* The classic frame holds no account menu, whose foot sets the theme, so it stands at the © line's end. */}
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <p className="text-xs text-fg-muted">
              <Year />
            </p>
            <ThemeRow place="footer" />
          </div>
        </div>
      </footer>
      <ToastRegion frame="classic" />
    </div>
  );
}
