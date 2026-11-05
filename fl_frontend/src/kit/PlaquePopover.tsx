"use client";

import { Button as AriaButton } from "react-aria-components/Button";
import { Dialog as AriaDialog, DialogTrigger } from "react-aria-components/Dialog";
import { Popover } from "react-aria-components/Popover";

import { COPY, textOf } from "@/core/copy";

import { useOpenUntilHidden } from "./Dialog";
import { popoverSurface } from "./fieldStyles";
import { Link } from "./Link";
import { plaqueLook } from "./TeamPlaque";

import type { RecordText, Words } from "@/core/copy";
import type { Route } from "next";

/**
 * A club's plaque as a button opening the club: on a phone a table names a club by its plaque alone, and the
 * plaque opens the club's full name and „Zum Team“ to its page, one block for every table whose plaques open. The
 * pop-up is the help popover's surface, anchored under the plaque. The button is positioned above a row's stretched
 * link, so a press on the plaque opens the club's pop-up rather than the row's record.
 */
export function PlaquePopover({ plaque, name, href }: { plaque: RecordText; name: Words; href: Route }) {
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
        className={popoverSurface({ width: "fit" })}>
        <AriaDialog
          aria-label={textOf(name)}
          data-kit-focus
          className="grid gap-2">
          <p className="font-semibold [overflow-wrap:anywhere]">{textOf(name)}</p>
          <Link
            href={href}
            placement="standalone"
            label={COPY.shared.toTeam}
          />
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}
