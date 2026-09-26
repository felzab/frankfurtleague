"use client";

import CircleInfo from "@gravity-ui/icons/CircleInfo";

import { Popover } from "@heroui/react/popover";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { hintTrigger } from "./hintTrigger";
import { overlayPanel } from "./overlayPanel";

import type { ReactNode } from "react";

/**
 * **A popover rather than a tooltip because of touch**: react-aria's tooltip never opens on a tap, so
 * on a phone it is unreachable, and `useHoverOpenOverlay` adds the hover half back.
 */
export function HintPopover({
  label,
  trigger,
  panelClassName,
  children,
}: {
  label: string;
  trigger?: ReactNode;
  panelClassName: string;
  children: ReactNode;
}) {
  const { isOpen, isDialogOpen, isOpenedByHover, panelKey, onOpenChange, openFromHover, captureDialog } = useHoverOpenOverlay();

  return (
    <Popover
      isOpen={isDialogOpen}
      onOpenChange={onOpenChange}>
      <Popover.Trigger
        aria-label={label}
        className={hintTrigger({ kind: trigger ? "custom" : "glyph", isOpen })}
        onPointerMove={openFromHover}>
        {trigger ?? (
          <CircleInfo
            aria-hidden="true"
            className="size-(--hint-icon-size)"
          />
        )}
      </Popover.Trigger>

      <Popover.Content
        key={panelKey}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        placement="top"
        offset={8}
        isNonModal={isOpenedByHover}>
        <HintPanel
          isOpenedByHover={isOpenedByHover}
          panelRef={captureDialog}
          className={panelClassName}>
          {children}
        </HintPanel>
      </Popover.Content>
    </Popover>
  );
}

/** Takes arbitrary children; a hint held to the length cap is `Hint`'s `reveal` mode. */
export function InfoHint({ label, children, trigger }: { label: string; children: ReactNode; trigger?: ReactNode }) {
  return (
    <HintPopover
      label={label}
      trigger={trigger}
      panelClassName={`${overlayPanel()} fluid-xs text-foreground [&_strong]:text-foreground flex w-max max-w-88 flex-col gap-y-2 p-4 leading-normal font-medium outline-none [&_strong]:font-bold [&_ul]:flex [&_ul]:flex-col [&_ul]:gap-y-1`}>
      {children}
    </HintPopover>
  );
}

/**
 * **No dialog for a panel the pointer opened**: react-aria's `Dialog` takes focus on mount whatever opened it, so a
 * pointer crossing the trigger would take the field being typed in (`useHoverOpenOverlay.ts :: useHoverOpenOverlay`).
 */
export function HintPanel({
  isOpenedByHover,
  panelRef,
  className,
  children,
}: {
  isOpenedByHover: boolean;
  panelRef: (element: HTMLElement | null) => void;
  className: string;
  children: ReactNode;
}) {
  if (isOpenedByHover)
    return (
      <div
        ref={panelRef}
        className={className}>
        {children}
      </div>
    );

  // No `aria-label`: react-aria names the dialog by its trigger, which names the hint or the control a refusal covers.
  return (
    <Popover.Dialog
      ref={panelRef}
      className={className}>
      {children}
    </Popover.Dialog>
  );
}
