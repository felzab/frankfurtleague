"use client";

import { DialogTrigger } from "react-aria-components/Dialog";
import { Sheet as AriaSheet, SheetBackdrop, SheetContent, SheetOverlay } from "react-aria-components/Sheet";

import { useOpenUntilHidden } from "./useOpenUntilHidden";

import type { Copy } from "@/core/copy";
import type { ReactElement, ReactNode } from "react";

/**
 * The bottom sheet itself, open while the trigger around it says so: a `DialogTrigger`, or a
 * `MenuTrigger` when a menu opens as a sheet on a phone; a second sheet over a first passes its own
 * state. The scrim and blur fade in with the swipe through the `kit-sheet-backdrop` keyframes in the
 * token file. A column, so the content takes what the handle leaves of the sheet: React Aria sets it the sheet's whole
 * height, and past the sheet's end it would never count as wholly in view, which is what lets it scroll
 * (`group-data-expanded`), and the end of a list taller than the sheet could not be reached.
 */
export function SheetFrame({
  label,
  isOpen,
  onOpenChange,
  children,
}: {
  label: Copy;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
  children: ReactNode;
}) {
  return (
    <SheetOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className="group/sheet z-50">
      <SheetBackdrop
        swipeAnimation="kit-sheet-backdrop"
        className="bg-scrim backdrop-blur-scrim"
      />
      <AriaSheet className="flex max-h-[92%] w-full flex-col overflow-clip rounded-t-xl bg-bg-overlay text-base text-fg shadow-dialog">
        {/* The handle: the sheet follows a swipe down and closes past its edge. */}
        <div className="mx-auto mt-3 mb-2 h-1 w-9 shrink-0 rounded-full bg-border-control/60" />
        <SheetContent
          aria-label={label}
          data-kit-focus
          className="box-border h-full min-h-0 overflow-hidden px-2 pb-[calc(1.5rem+var(--sheet-scroll-padding-y))] group-data-expanded/sheet:overflow-auto">
          {children}
        </SheetContent>
      </AriaSheet>
    </SheetOverlay>
  );
}

/**
 * More on a phone: a sheet from the bottom, the page dimmed and blurred behind it. „Mehr“ and the
 * account menu open as sheets, and so does the phone's filter block. `DialogTrigger`, which marks its trigger pressed
 * while what it opened stands, as a menu's trigger is: React Aria's `SheetTrigger` is that component with the mark
 * taken off.
 */
export function Sheet({ label, trigger, children }: { label: Copy; trigger: ReactElement; children: ReactNode }) {
  const [isOpen, setOpen] = useOpenUntilHidden();
  return (
    <DialogTrigger
      isOpen={isOpen}
      onOpenChange={setOpen}>
      {trigger}
      <SheetFrame label={label}>{children}</SheetFrame>
    </DialogTrigger>
  );
}
