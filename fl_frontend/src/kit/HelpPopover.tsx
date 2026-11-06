"use client";

import { Dialog as AriaDialog, DialogTrigger } from "react-aria-components/Dialog";
import { Popover } from "react-aria-components/Popover";

import { popoverSurface } from "./fieldStyles";
import { useOpenUntilHidden } from "./useOpenUntilHidden";

import type { Copy } from "@/core/copy";
import type { ReactElement } from "react";

/**
 * A short text in a 320-px pop-up under the control that opens it, on the page, which it neither dims nor blurs: a few
 * declarative lines, each statement a line of its own. It opens from the ⓘ after a section's title, which `Section`
 * places from its `help` prop, so a section has one at most.
 */
export function HelpPopover({
  subject,
  lines,
  children,
}: {
  /** What names the pop-up: a section's title. */
  subject: Copy;
  lines: readonly [Copy, ...Copy[]];
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
        placement="bottom start"
        offset={4}
        crossOffset={-8}
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
