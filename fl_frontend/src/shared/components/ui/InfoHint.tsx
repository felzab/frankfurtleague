"use client";

import { CircleInfo } from "@gravity-ui/icons";

import { Popover } from "@heroui/react";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { hintTrigger } from "./hintTrigger";
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
      <Popover.Trigger
        aria-label={label}
        className={hintTrigger({ kind: trigger ? "custom" : "glyph", isOpen })}
        onMouseEnter={openFromHover}>
        {trigger ?? <CircleInfo className="h-(--hint-icon-size) w-(--hint-icon-size)" />}
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
