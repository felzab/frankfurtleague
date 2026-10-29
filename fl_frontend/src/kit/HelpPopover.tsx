"use client";

import { Dialog as AriaDialog, DialogTrigger } from "react-aria-components/Dialog";
import { Popover } from "react-aria-components/Popover";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { useOpenUntilHidden } from "./Dialog";

import type { Copy } from "@/core/copy";

/**
 * The one ⓘ after a section's title, opening a 320-px pop-up with a short help text on the page, which
 * it neither dims nor blurs. `Section` places it from its `help` prop, so a section has one at most.
 */
export function HelpPopover({ subject, text }: { /** The section's title, which names the pop-up. */ subject: Copy; text: Copy }) {
  const [isOpen, setOpen] = useOpenUntilHidden();
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      <Button
        icon="info"
        label={COPY.shared.hilfe}
      />
      <Popover
        placement="bottom start"
        offset={4}
        crossOffset={-8}
        data-kit-focus
        className="w-popover max-w-panel rounded-lg border border-border bg-bg p-3 text-sm text-fg shadow-menu transition-opacity duration-(--motion-in) data-entering:opacity-0 data-exiting:opacity-0 data-exiting:duration-(--motion-out)">
        <AriaDialog
          aria-label={subject}
          data-kit-focus>
          {text}
        </AriaDialog>
      </Popover>
    </DialogTrigger>
  );
}
