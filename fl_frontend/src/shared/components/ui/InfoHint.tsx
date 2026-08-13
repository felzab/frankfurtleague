"use client";

import { CircleInfo } from "@gravity-ui/icons";

import { Popover } from "@heroui/react";

import { useHoverOpenOverlay } from "@/shared/hooks/useHoverOpenOverlay";

import { overlayPanel } from "./overlayPanel";

import type { ReactNode } from "react";

/**
 * A short explanation of a surface, behind a small icon beside its title — the rich-content sibling
 * of `IconTooltip`.
 *
 * **A popover rather than a tooltip, because of touch**: react-aria's tooltip opens on hover and
 * focus but deliberately never on tap, so on a phone it is unreachable. A popover opens on press;
 * the hover half is added for pointer users.
 *
 * **The hover half is `useHoverOpenOverlay`**, shared with `DisabledHint`, which answers the same
 * question about a control rather than about a surface.
 *
 * `children` is a node: a hint long enough to need this surface needs structure (a lead, a list, a
 * bolded term), and the dialog styles those tags. `trigger` swaps the default icon — the change
 * list's operation icons ride the same mechanism.
 */
export function InfoHint({ label, children, trigger }: { label: string; children: ReactNode; trigger?: ReactNode }) {
  const { isOpen, onOpenChange, openFromHover, captureDialog } = useHoverOpenOverlay();

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}>
      {/* `cursor-help` is the affordance: it says "this holds an explanation" where a bare icon
          does not.

          The default icon is an INLINE glyph, not a flex sibling: it lives inside the heading's own
          text flow. Centring in a flex row can never look right, because the text's visual mass
          sits above its line box's centre. `align-middle` does the
          rest natively: per the CSS spec it pins the box's vertical midpoint to the parent's
          baseline plus half the parent's x-height — the middle of the text's visual mass — so any
          icon size and any text size stay aligned with no tuned constant. To resize the icon,
          change `--hint-icon-size` alone. */}
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
