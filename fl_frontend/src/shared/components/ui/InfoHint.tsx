"use client";

import { useState } from "react";

import { CircleInfo } from "@gravity-ui/icons";

import { Popover } from "@heroui/react";

import { overlayPanel } from "./overlayPanel";

/**
 * A short explanation of what a section is for, behind a small icon beside its title.
 *
 * **A popover rather than `IconTooltip`, and the reason is touch.** react-aria's tooltip opens on hover
 * and on keyboard focus and deliberately does not open on tap — a tooltip is a pointer affordance, and
 * on a phone it is simply unreachable. A popover opens on press, which covers touch, and the two mouse
 * handlers below add hover on top: "hover on desktop, tap on mobile", which is what an explanation
 * beside a heading has to do to be worth putting there.
 *
 * **It exists so the fields underneath can stop explaining themselves.** A description under every
 * input is weight on the surface that can least afford it, and most of what those descriptions said was
 * about the section rather than the field. It lives here instead, out of the way until it is asked for.
 *
 * `Popover.Trigger` IS the control and no `<button>` goes inside it: it renders a `div role="button"`
 * wrapped in react-aria's `Pressable`, which is focusable in its own right, so nesting a real button
 * gives two tab stops with two differently-shaped outlines — the trap `TeamPopoverMenu` documents.
 *
 * On touch the tap opens it through `Pressable` and the synthetic `mouseenter` that follows only
 * re-asserts what is already open; it closes on the next press outside, which is the popover's own
 * dismiss behaviour.
 */
export function InfoHint({ label, children }: { label: string; children: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}>
      <Popover.Trigger
        aria-label={label}
        className="text-foreground-muted hover:text-brand inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors"
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}>
        <CircleInfo className="size-4" />
      </Popover.Trigger>

      <Popover.Content
        placement="top"
        offset={8}>
        <Popover.Dialog
          className={`${overlayPanel()} fluid-xxs text-foreground w-max max-w-[17rem] p-3 leading-normal font-medium outline-none`}>
          {children}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
