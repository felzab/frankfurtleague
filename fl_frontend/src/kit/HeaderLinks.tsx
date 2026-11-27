"use client";

import { usePathname } from "next/navigation";

import { Button as AriaButton } from "react-aria-components/Button";

import { COPY } from "@/core/copy/shared";

import { hoverLook } from "./hoverStyles";
import { Icon } from "./Icon";
import { frameLink, menuEntry } from "./Link";
import { currentOf } from "./navPlace";
import { FreshPerPage, Sheet } from "./Sheet";
import { NavigationLink, usePressed } from "./WholePage";

import type { Copy } from "@/core/copy";
import type { Route } from "next";

export type HeaderLink = { label: Copy; href: Route };

type HeaderLinksProps = {
  links: ReadonlyArray<HeaderLink>;
  signIn: Route;
};

/**
 * The classic header's links and „Konto“, the way to the sign-in, on the band: in a row from 1024 px, and on a phone behind
 * one button opening them as a sheet. The page's link is marked, „Konto“ on the sign-in's pages among them, or from its
 * press the link a navigation goes to, and the sheet goes with the page it led from, since the layout outlives the page.
 */
export function HeaderLinks({ links, signIn }: HeaderLinksProps) {
  const path = usePathname();
  const hrefs = [...links.map((link) => link.href), signIn];
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
            place={{ list: "band", current: link.href === current }}
            data-kit-focus="ring"
            className={frameLink({ tone: "band" })}>
            {link.label}
          </NavigationLink>
        ))}
      </nav>
      <NavigationLink
        href={signIn}
        place={{ list: "band", current: signIn === current }}
        data-kit-focus="ring"
        className={frameLink({ tone: "band", class: "ms-auto hidden lg:flex" })}>
        {COPY.template.account}
      </NavigationLink>
      <div className="ms-auto lg:hidden">
        <FreshPerPage>
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
                  place={{ list: "menu", current: link.href === current }}
                  data-kit-focus="inset"
                  className={menuEntry({ size: "phone" })}>
                  {link.label}
                </NavigationLink>
              ))}
            </div>
          </Sheet>
        </FreshPerPage>
      </div>
    </>
  );
}
