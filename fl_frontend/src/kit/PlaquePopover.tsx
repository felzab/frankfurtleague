"use client";

import NextLink from "next/link";

import { Button as AriaButton } from "react-aria-components/Button";
import { Dialog as AriaDialog, DialogTrigger } from "react-aria-components/Dialog";
import { Popover } from "react-aria-components/Popover";

import { COPY, textOf } from "@/core/copy";

import { useOpenUntilHidden } from "./Dialog";
import { popoverSurface } from "./fieldStyles";
import { Icon } from "./Icon";
import { menuEntry } from "./Link";
import { plaqueLook } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, RecordText, Words } from "@/core/copy";
import type { Route } from "next";
import type { IconName } from "./Icon";

// A menu's entry, as tall as every control under a mouse and under a finger, filling under the pointer.
const entry = tv({
  extend: menuEntry,
  base: "transition-colors duration-(--motion-state) hover:bg-bg-muted pointer-coarse:h-10 pointer-coarse:text-base",
});

/** One way on from the club: its glyph, then its words. */
function Entry({ href, icon, label }: { href: Route; icon: IconName; label: Copy }) {
  return (
    <NextLink
      href={href}
      data-kit-focus="inset"
      className={entry({ size: "desktop" })}>
      <span className="text-fg-muted">
        <Icon
          glyph={icon}
          size={16}
        />
      </span>
      {label}
    </NextLink>
  );
}

/**
 * A club's plaque as a button opening the club: on a phone a table names a club by its plaque alone, and the
 * plaque opens a small menu, one block for every table whose plaques open. In the menu's own shape, as the account
 * menu heads its entries: the club's full name over its line, such as its group, a hairline, then „Zum Team“ to
 * its page and „Kader“ to the squad on it. On the pop-up's surface, whose edge sets it apart from the row it opens
 * over, anchored under the plaque. The button is positioned above a row's stretched link, so a press on the plaque
 * opens the club's pop-up rather than the row's record.
 */
export function PlaquePopover({ plaque, name, href, line }: { plaque: RecordText; name: Words; href: Route; line?: Copy }) {
  const [isOpen, setOpen] = useOpenUntilHidden();
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      <AriaButton
        data-kit-focus="ring"
        className={plaqueLook({ known: true, class: "relative z-10 cursor-pointer" })}>
        {plaque.record}
      </AriaButton>
      <Popover
        placement="bottom start"
        offset={4}
        data-kit-focus
        // The menu's 4-px inset around its entries, and the control edge, which stands apart from the row's
        // own surface where the hairline is lost on it.
        className={popoverSurface({ width: "fit", class: "border-border-control p-1" })}>
        <AriaDialog
          aria-label={textOf(name)}
          data-kit-focus
          className="grid">
          <p className="grid px-3 py-2">
            <span className="font-semibold [overflow-wrap:anywhere]">{textOf(name)}</span>
            {line !== undefined && <span className="text-xs text-fg-muted">{line}</span>}
          </p>
          <span
            aria-hidden
            className="my-1 border-t border-border"
          />
          <span className="grid gap-1">
            <Entry
              href={href}
              icon="teams"
              label={COPY.shared.toTeam}
            />
            <Entry
              href={`${href}#kader` as Route}
              icon="pupils"
              label={COPY.shared.kader}
            />
          </span>
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}
