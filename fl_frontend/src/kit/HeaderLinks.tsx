"use client";

import { Suspense, use } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

import { Button as AriaButton } from "react-aria-components/Button";

import { COPY } from "@/core/copy";

import { Icon } from "./Icon";
import { frameLink, menuEntry } from "./Link";
import { currentOf, FreshPerPage } from "./navPlace";
import { Sheet } from "./Sheet";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

/** A link of the classic header: catalogue words and an address the layout gives. */
export type HeaderLink = { label: Copy; href: Route };

/** The season the site is on as the header's first entry, once its read lands; none while the league has none. */
function SeasonEntry({ read, look }: { read: Promise<HeaderLink | null>; look: "band" | "sheet" }) {
  const link = use(read);
  if (link === null) return null;
  return (
    <NextLink
      href={link.href}
      data-kit-focus={look === "band" ? "ring" : "inset"}
      className={look === "band" ? frameLink({ tone: "bandMuted" }) : menuEntry({ size: "phone" })}>
      {link.label}
    </NextLink>
  );
}

/**
 * The classic header's links and „Anmelden“ on the band: in a row from 1024 px, and on a phone behind one
 * button opening them as a sheet. The season's entry leads them once its read lands; while it waits it holds no
 * width and the band its fixed height, so nothing beside it moves up or down.
 */
export function HeaderLinks({
  season,
  links,
  signIn,
}: {
  /** The season the site is on, read on a request, or null where the league has none. */
  season?: Promise<HeaderLink | null>;
  links: ReadonlyArray<HeaderLink>;
  signIn: Route;
}) {
  const current = currentOf(
    usePathname(),
    links.map((link) => link.href),
  );
  return (
    <>
      <nav
        aria-label={COPY.template.navigation}
        className="hidden gap-2 lg:flex">
        {season !== undefined && (
          <Suspense fallback={null}>
            <SeasonEntry
              read={season}
              look="band"
            />
          </Suspense>
        )}
        {links.map((link) => (
          <NextLink
            key={link.href}
            href={link.href}
            aria-current={link.href === current ? "page" : undefined}
            data-kit-focus="ring"
            className={frameLink({ tone: link.href === current ? "band" : "bandMuted" })}>
            {link.label}
          </NextLink>
        ))}
      </nav>
      <NextLink
        href={signIn}
        data-kit-focus="ring"
        className={frameLink({ tone: "band", class: "ms-auto hidden lg:flex" })}>
        {COPY.shared.verb.signIn}
      </NextLink>
      <div className="ms-auto lg:hidden">
        <FreshPerPage>
          <Sheet
            label={COPY.template.menu}
            trigger={
              <AriaButton
                aria-label={COPY.template.menu}
                data-kit-focus="ring"
                className="flex size-10 items-center justify-center rounded-lg text-on-brand">
                <Icon
                  glyph="menu"
                  size={18}
                />
              </AriaButton>
            }>
            <div className="grid gap-1 pt-2">
              {season !== undefined && (
                <Suspense fallback={null}>
                  <SeasonEntry
                    read={season}
                    look="sheet"
                  />
                </Suspense>
              )}
              {[...links, { label: COPY.shared.verb.signIn, href: signIn }].map((link) => (
                <NextLink
                  key={link.href}
                  href={link.href}
                  aria-current={link.href === current ? "page" : undefined}
                  data-kit-focus="inset"
                  className={menuEntry({ size: "phone" })}>
                  {link.label}
                </NextLink>
              ))}
            </div>
          </Sheet>
        </FreshPerPage>
      </div>
    </>
  );
}
