"use client";

import { Fragment } from "react";
import { usePathname } from "next/navigation";

import { Button as AriaButton } from "react-aria-components/Button";

import { COPY } from "@/core/copy";

import { hoverLook } from "./hoverStyles";
import { Icon } from "./Icon";
import { frameLink, menuEntry } from "./Link";
import { currentOf } from "./navPlace";
import { Sheet } from "./Sheet";
import { NavigationLink, usePressed } from "./WholePage";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

/** A link of the classic header: catalogue words and an address the layout gives. */
export type HeaderLink = { label: Copy; href: Route };

type HeaderLinksProps = {
  links: ReadonlyArray<HeaderLink>;
  signIn: Route;
};

/**
 * The classic header's links and „Konto“, the way to the sign-in, on the band: in a row from 1024 px, and on a phone behind
 * one button opening them as a sheet. The page's link is marked, or from its press the link a navigation goes to, and
 * the sheet goes with the page it led from, since the layout outlives the page.
 */
export function HeaderLinks({ links, signIn }: HeaderLinksProps) {
  const path = usePathname();
  const hrefs = links.map((link) => link.href);
  const pressed = usePressed(hrefs);
  const current = pressed ?? currentOf(path, hrefs);
  return (
    <>
      <nav
        aria-label={COPY.template.navigation}
        className="hidden gap-2 lg:flex">
        {links.map((link) => (
          <NavigationLink
            key={link.href}
            href={link.href}
            aria-current={link.href === current ? "page" : undefined}
            data-kit-focus="ring"
            className={frameLink({ tone: link.href === current ? "band" : "bandMuted" })}>
            {link.label}
          </NavigationLink>
        ))}
      </nav>
      <NavigationLink
        href={signIn}
        data-kit-focus="ring"
        className={frameLink({ tone: "band", class: "ms-auto hidden lg:flex" })}>
        {COPY.template.account}
      </NavigationLink>
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
              {[...links, { label: COPY.template.account, href: signIn } satisfies HeaderLink].map((link) => (
                <NavigationLink
                  key={link.href}
                  href={link.href}
                  aria-current={link.href === current ? "page" : undefined}
                  data-kit-focus="inset"
                  className={menuEntry({ size: "phone" })}>
                  {link.label}
                </NavigationLink>
              ))}
            </div>
          </Sheet>
        </Fragment>
      </div>
    </>
  );
}
