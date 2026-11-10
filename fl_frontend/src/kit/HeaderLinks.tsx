"use client";

import { Fragment, Suspense, use } from "react";
import NextLink from "next/link";
import { usePathname } from "next/navigation";

import { Button as AriaButton } from "react-aria-components/Button";

import { COPY } from "@/core/copy";

import { hoverLook } from "./hoverStyles";
import { Icon } from "./Icon";
import { frameLink, menuEntry } from "./Link";
import { currentOf } from "./navPlace";
import { Sheet } from "./Sheet";
import { Placeholder, PlaceholderLine, SAISON_WORDS } from "./Skeleton";

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

type HeaderLinksProps = {
  /** The season the site is on, read on a request, or null where the league has none. */
  season?: Promise<HeaderLink | null>;
  links: ReadonlyArray<HeaderLink>;
  signIn: Route;
};

/**
 * The links at the address `path`: its page's link marked, and a sheet that goes with the page it led from, since the
 * layout outlives the page. `null` while a page with a dynamic segment streams its address, where no link is marked.
 */
function PlacedLinks({ season, links, signIn, path }: HeaderLinksProps & { path: string | null }) {
  const current =
    path === null
      ? null
      : currentOf(
          path,
          links.map((link) => link.href),
        );
  return (
    <>
      <nav
        aria-label={COPY.template.navigation}
        className="hidden gap-2 lg:flex">
        {season !== undefined && (
          // The entry's place held meanwhile at its own width, so the links beside it never move when it lands.
          <Suspense
            fallback={
              <Placeholder layoutClass={frameLink({ tone: "bandMuted" })}>
                <PlaceholderLine
                  textClass="text-sm"
                  words={SAISON_WORDS}
                />
              </Placeholder>
            }>
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
        {COPY.template.account}
      </NextLink>
      <div className="ms-auto lg:hidden">
        <Fragment key={path}>
          <Sheet
            label={COPY.template.menu}
            trigger={
              <AriaButton
                aria-label={COPY.template.menu}
                data-kit-focus="ring"
                className={`flex size-10 items-center justify-center rounded-lg text-on-brand ${hoverLook({ host: "aria" })}`}>
                <Icon
                  glyph="menu"
                  size={18}
                />
              </AriaButton>
            }>
            <div className="grid gap-1 pt-2">
              {season !== undefined && (
                <Suspense
                  fallback={
                    <Placeholder layoutClass={menuEntry({ size: "phone" })}>
                      <PlaceholderLine
                        textClass="text-base"
                        words={SAISON_WORDS}
                      />
                    </Placeholder>
                  }>
                  <SeasonEntry
                    read={season}
                    look="sheet"
                  />
                </Suspense>
              )}
              {[...links, { label: COPY.template.account, href: signIn }].map((link) => (
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
        </Fragment>
      </div>
    </>
  );
}

function LinksAtAddress(props: HeaderLinksProps) {
  return (
    <PlacedLinks
      {...props}
      path={usePathname()}
    />
  );
}

/**
 * The classic header's links and „Konto“, the way to the sign-in, on the band: in a row from 1024 px, and on a phone behind
 * one button opening them as a sheet. The season's entry leads them once its read lands; while it waits its placeholder
 * holds its width and the band its fixed height, so nothing beside it moves. Past a dynamic segment the prerendered shell
 * holds no address, so it holds the same links unmarked, which is why the boundary stands here and not in the page.
 */
export function HeaderLinks(props: HeaderLinksProps) {
  return (
    <Suspense
      fallback={
        <PlacedLinks
          {...props}
          path={null}
        />
      }>
      <LinksAtAddress {...props} />
    </Suspense>
  );
}
