import { cacheLife, cacheTag } from "next/cache";
import Image from "next/image";

import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { SITE_CACHE_TAG } from "@/core/siteCache";

import { Brand } from "./Brand";
import { smallCaps } from "./cardStyles";
import { HeaderLinks } from "./HeaderLinks";
import { Link } from "./Link";
import { ToastRegion } from "./Toast";
import { NavigationBar } from "./WholePage";

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

/** One of the footer's link groups under its heading, a landmark named by it. */
function FooterGroup({ heading, links }: { heading: Copy; links: ReadonlyArray<HeaderLink> }) {
  return (
    <nav
      aria-label={heading}
      className="grid content-start gap-1">
      <h2 className={smallCaps({ class: "mb-2" })}>{heading}</h2>
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          placement="footer"
          label={link.label}
        />
      ))}
    </nav>
  );
}

/**
 * The classic public frame, which a layout places around the landing, About, Kontakt, the sponsors page,
 * the legal pages, the application form, the pages a mail opens and the sign-in: the dark-green band with
 * the logo, its links and „Konto“, the way to the sign-in, at the top, the footer at the foot. The footer holds the logo and the
 * league's line at the left with Instagram and Threads as glyph links under them, the question door's, and to
 * their right three link groups, „Saison“, „Liga“ and „Rechtliches“, two a row on a phone; under them the sponsors'
 * logos under „Mit Unterstützung von“ above the © line. Its links are all known before any read, so the footer
 * stands outside every boundary and never waits.
 *
 * Each page's template writes its title and its content through `ClassicPage` and `ClassicTitle`.
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
  /** The header's links, between the logo and „Konto“, the way to the sign-in. */
  links: ReadonlyArray<HeaderLink>;
  /** Where „Konto“, the way to the sign-in, leads. */
  signIn: Route;
  /** The „Saison“ group's links. */
  saison: ReadonlyArray<HeaderLink>;
  /** The „Liga“ group's links. */
  liga: ReadonlyArray<HeaderLink>;
  /** The „Rechtliches“ group's links, the legal pages. */
  legal: ReadonlyArray<HeaderLink>;
  social: { instagram: string; threads: string };
  /** Each sponsor's logo, small and grey, as a link to its site, its full name the logo's name, its short name beside it where it has one; no line while there are none. */
  sponsors: ReadonlyArray<Sponsor>;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* A picture of its own in a page's cross-fade, so the page scrolled under it is not drawn over it (`tokens.css`). */}
      <header className="sticky top-0 z-20 shrink-0 bg-brand-solid px-4 text-on-brand [--bar-ink:var(--on-brand)] [--focus-ring:var(--on-brand)] [view-transition-name:band] lg:px-8">
        <div className="@container mx-auto flex h-(--classic-header) w-full max-w-classic items-center gap-2 lg:gap-8">
          <Brand ground="band" />
          <HeaderLinks
            links={links}
            signIn={signIn}
          />
        </div>
      </header>
      <NavigationBar placement="classic" />

      {children}

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
                      {/* An SVG served as it is, which the image optimiser has nothing to do for; small and grey,
                        each logo fitted into the same box whatever its own proportions. */}
                      <span className="relative block h-6 w-24">
                        <Image
                          src={sponsor.logo}
                          alt={sponsor.name.record}
                          fill
                          unoptimized
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
          <p className="text-xs text-fg-muted">
            <Year />
          </p>
        </div>
      </footer>
      <ToastRegion frame="classic" />
    </div>
  );
}
