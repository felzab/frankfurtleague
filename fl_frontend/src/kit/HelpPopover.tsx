"use client";

import { Dialog as AriaDialog, DialogTrigger } from "react-aria-components/Dialog";
import { Popover } from "react-aria-components/Popover";

import { popoverSurface } from "./fieldStyles";
import { useOpenUntilHidden } from "./useOpenUntilHidden";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

/** The edge of its control a pop-up opens from: an act's at a row's end, or the control's at a column's start. */
export type PopoverEdge = "start" | "end";

/**
 * A short text in a 320-px pop-up under the control that opens it, on the page, which it neither dims nor blurs: a few
 * declarative lines, each statement a line of its own. It opens from the ⓘ after a section's title, which `Section`
 * places from its `help` prop, so a section has one at most, and from a locked act's button, as its reason (`Button`).
 */
export function HelpPopover({
  subject,
  lines,
  edge = "start",
  children,
}: {
  /** What names the pop-up, such as a section's title; without one, React Aria names it by its trigger. */
  subject?: Copy;
  lines: readonly [Copy, ...Copy[]];
  edge?: PopoverEdge;
  /** The kit `Button` that opens it. */
  children: ReactElement;
}) {
  const [isOpen, setOpen] = useOpenUntilHidden();
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      {children}
      <Popover
        placement={`bottom ${edge}`}
        offset={4}
        crossOffset={edge === "start" ? -8 : 0}
        data-kit-focus
        className={popoverSurface({ width: "help" })}>
        <AriaDialog
          aria-label={subject}
          data-kit-focus
          className="grid gap-1">
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}
