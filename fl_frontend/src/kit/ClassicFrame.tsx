import { cacheLife } from "next/cache";
import Image from "next/image";
import NextLink from "next/link";

import { tv } from "tailwind-variants/lite";

import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { Brand } from "./Brand";
import { HeaderLinks } from "./FrameNav";
import { ToastRegion } from "./Toast";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { HeaderLink } from "./FrameNav";

/** A sponsor in the footer: its logo, small and grey, as a link to its site, its name the logo's name. */
export type FooterSponsor = { name: string; logo: string; href: string };

/** The year the © line names, read once a day rather than on every request. */
async function Jahr() {
  "use cache";
  cacheLife("days");
  return COPY.vorlage.copyright(now().getFullYear(), COPY.marke.name);
}

const footerLink = tv({ base: "rounded-md text-sm leading-6 text-fg-muted hover:text-fg" });

/**
 * The classic public frame, which a layout places around the landing, About, Kontakt, the sponsors page,
 * the legal pages, the application form, the pages a mail opens and the sign-in: the dark-green band with
 * the logo, its links and „Anmelden“ at the top, the footer at the foot. The footer holds the league's line,
 * Instagram and Threads, its link groups, „Sponsoren“ under „Liga“, and the sponsors' logos under „Mit
 * Unterstützung von“ above the © line.
 *
 * Each page's template writes its title and its content through `ClassicPage` and `ClassicTitle`.
 */
export function ClassicFrame({
  links,
  anmelden,
  groups,
  liga,
  social,
  sponsors,
  children,
}: {
  /** The header's links, between the logo and „Anmelden“. */
  links: ReadonlyArray<HeaderLink>;
  /** Where „Anmelden“ leads. */
  anmelden: Route;
  /** The footer's link groups beside the league's own, each under its heading. */
  groups: ReadonlyArray<{ heading: Copy; links: ReadonlyArray<HeaderLink> }>;
  /** The „Liga“ group's links before „Sponsoren“, which closes it. */
  liga: ReadonlyArray<HeaderLink>;
  /** The league's Instagram and Threads addresses. */
  social: { instagram: string; threads: string };
  sponsors: ReadonlyArray<FooterSponsor>;
  children: ReactNode;
}) {
  const ligaLinks = [...liga, { label: COPY.seite.sponsoren, href: ROUTES.sponsoren.pfad() }];
  return (
    // The header's height is declared once, here, for the header and for a page filling the first screen
    // under it (`ClassicPage`'s `fillsScreen`).
    <div className="flex min-h-dvh flex-col [--classic-header:3.5rem] lg:[--classic-header:4rem]">
      <header className="sticky top-0 z-20 shrink-0 bg-brand-solid text-on-brand [--focus-ring:var(--on-brand)]">
        <div className="@container mx-auto flex h-(--classic-header) w-full max-w-[65rem] items-center gap-2 px-4 lg:gap-8 lg:px-8">
          <Brand ground="band" />
          <HeaderLinks
            links={links}
            anmelden={anmelden}
          />
        </div>
      </header>

      {children}

      <footer className="shrink-0 border-t border-border bg-bg">
        <div className="mx-auto grid w-full max-w-[65rem] gap-6 px-4 py-6 lg:px-8 lg:py-8">
          <div className="grid gap-6 lg:grid-cols-[2fr_1fr_1fr]">
            <div className="grid content-start gap-2">
              <Brand ground="page" />
              <p className="text-sm text-fg-muted">{COPY.vorlage.oberstufenliga}</p>
              <div className="flex gap-4">
                <NextLink
                  href={social.instagram}
                  data-kit-focus="text"
                  className={footerLink()}>
                  {COPY.vorlage.instagram}
                </NextLink>
                <NextLink
                  href={social.threads}
                  data-kit-focus="text"
                  className={footerLink()}>
                  {COPY.vorlage.threads}
                </NextLink>
              </div>
            </div>
            {[{ heading: COPY.vorlage.liga, links: ligaLinks }, ...groups].map((group) => (
              <nav
                key={group.heading}
                aria-label={group.heading}
                className="grid content-start gap-1">
                <h2 className="mb-1 text-xs font-semibold tracking-[0.04em] text-fg-muted uppercase">{group.heading}</h2>
                {group.links.map((link) => (
                  <NextLink
                    key={link.href}
                    href={link.href}
                    data-kit-focus="text"
                    className={footerLink()}>
                    {link.label}
                  </NextLink>
                ))}
              </nav>
            ))}
          </div>
          {sponsors.length > 0 && (
            <div className="grid gap-2">
              <p className="text-xs text-fg-muted">{COPY.vorlage.mitUnterstuetzungVon}</p>
              <div className="flex flex-wrap items-center gap-6">
                {sponsors.map((sponsor) => (
                  <NextLink
                    key={sponsor.href}
                    href={sponsor.href}
                    rel="sponsored noopener"
                    title={sponsor.name}
                    data-kit-focus="ring"
                    className="relative block h-6 w-24 rounded-md">
                    {/* An SVG served as it is, which the image optimiser has nothing to do for; small and grey,
                        each logo fitted into the same box whatever its own proportions. */}
                    <Image
                      src={sponsor.logo}
                      alt={sponsor.name}
                      fill
                      unoptimized
                      sizes="6rem"
                      className="object-contain object-left grayscale"
                    />
                  </NextLink>
                ))}
              </div>
            </div>
          )}
          <p className="text-xs text-fg-muted">
            <Jahr />
          </p>
        </div>
      </footer>
      <ToastRegion frame="classic" />
    </div>
  );
}
