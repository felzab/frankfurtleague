"use client";

import { CircleInfo } from "@gravity-ui/icons";

import { Popover } from "@heroui/react";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { overlayPanel } from "./overlayPanel";

import type { ReactNode } from "react";

/**
 * A popover rather than a tooltip because of touch, which `Hint` carries in full (COR-2). This one takes arbitrary
 * children; a hint held to the length cap is `Hint`'s `reveal` mode.
 */
export function InfoHint({ label, children, trigger }: { label: string; children: ReactNode; trigger?: ReactNode }) {
  const { isOpen, onOpenChange, openFromHover, captureDialog } = useHoverOpenOverlay();

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}>
      {/* An inline glyph rather than a flex sibling: a text run's visual mass sits above its line box's centre, so
          centring in a row cannot look right. `align-middle` aligns any icon size with no tuned constant. */}
      <Popover.Trigger
        aria-label={label}
        className={
          trigger
            ? "hover:bg-hover -m-0.5 inline-flex shrink-0 cursor-help items-center justify-center rounded-md p-0.5 align-middle transition-colors"
            : "text-foreground-muted hover:text-brand ms-1.5 inline-flex shrink-0 cursor-help align-middle transition-colors [--hint-icon-size:1em]"
        }
        onMouseEnter={openFromHover}>
        {trigger ?? <CircleInfo className="h-(--hint-icon-size) w-(--hint-icon-size) cursor-help" />}
      </Popover.Trigger>

      <Popover.Content
        placement="top"
        offset={8}>
        <Popover.Dialog
          ref={captureDialog}
          className={`${overlayPanel()} fluid-xs text-foreground [&_strong]:text-foreground flex w-max max-w-88 flex-col gap-y-2 p-4 leading-normal font-medium outline-none [&_strong]:font-bold [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-y-1.5`}>
          {children}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
