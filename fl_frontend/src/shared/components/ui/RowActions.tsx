"use client";

import Link from "next/link";

import { ArrowRotateLeft, Copy, Ellipsis, TrashBin } from "@gravity-ui/icons";

import { Button, Dropdown, Label } from "@heroui/react";

import { Hint } from "./Hint";
import { IconTooltip } from "./IconTooltip";
import { ROW_ACTION_SIZE } from "./rowActionSize";

import type { ReactNode } from "react";

/**
 * The shape every row action shares, so a link's hit area and a button's cannot drift; only the hover arm splits. The
 * tooltip is wired as `aria-describedby`, which never names the control, so every action takes an `ariaLabel` too.
 */
const ACTION_SHAPE = `text-foreground-muted flex ${ROW_ACTION_SIZE} shrink-0 items-center justify-center rounded-xl transition-colors`;

const ACTION_LINK_CLASS = `${ACTION_SHAPE} hover:bg-hover hover:text-brand`;

/**
 * `disabled:pointer-events-none` is load-bearing: a disabled control dispatches no pointer event and none reaches an
 * ancestor either, so the refusal hint's wrapper is the hit target only once this makes the button transparent.
 */
const ACTION_BUTTON_SHAPE = `${ACTION_SHAPE} disabled:pointer-events-none`;

const ACTION_BUTTON_CLASS = `${ACTION_BUTTON_SHAPE} data-hovered:bg-hover data-hovered:text-brand`;

const DANGER_CLASS = `${ACTION_BUTTON_SHAPE} data-hovered:bg-hover-danger data-hovered:text-danger-strong`;

export function RowActionLink({
  href,
  label,
  ariaLabel,
  external,
  children,
}: {
  href: string;
  label: string;
  ariaLabel: string;
  external?: boolean;
  children: ReactNode;
}) {
  return (
    <IconTooltip label={label}>
      <Link
        href={href}
        aria-label={ariaLabel}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className={ACTION_LINK_CLASS}>
        {children}
      </Link>
    </IconTooltip>
  );
}

export function RowActionCopy({ label, ariaLabel, onPress }: { label: string; ariaLabel: string; onPress: () => void }) {
  return (
    <IconTooltip label={label}>
      <Button
        isIconOnly
        aria-label={ariaLabel}
        variant="ghost"
        className={ACTION_BUTTON_CLASS}
        onPress={onPress}>
        <Copy
          className="size-4.5"
          aria-hidden="true"
        />
      </Button>
    </IconTooltip>
  );
}

/**
 * Shown in `RowActionDelete`'s place on a retired row. No confirmation step: one press of the delete reverses it.
 *
 * It takes the delete's `disabledReason`; `ACTION_BUTTON_SHAPE` carries the mechanism both rely on.
 */
export function RowActionRestore({
  label,
  ariaLabel,
  onPress,
  disabledReason,
}: {
  label: string;
  ariaLabel: string;
  onPress: () => void;
  /**
   * The refusal this row can already see, or null while the return is offered. Offering what the endpoint refuses is one
   * defect whichever control reaches it, and a list reaches the squad row's reactivate as its editor does.
   */
  disabledReason?: string | null;
}) {
  const button = (
    <Button
      isIconOnly
      aria-label={ariaLabel}
      variant="ghost"
      isDisabled={disabledReason != null}
      className={ACTION_BUTTON_CLASS}
      onPress={onPress}>
      <ArrowRotateLeft
        className="size-4.5"
        aria-hidden="true"
      />
    </Button>
  );

  return disabledReason != null ? (
    <Hint
      mode="refusal"
      reason={disabledReason}>
      {button}
    </Hint>
  ) : (
    <IconTooltip label={label}>{button}</IconTooltip>
  );
}

/** `disabledReason` is what disables the control, rather than a boolean beside a reason, so the two cannot drift apart. */
export function RowActionDelete({
  label,
  ariaLabel,
  onPress,
  disabledReason,
}: {
  label: string;
  ariaLabel: string;
  onPress: () => void;
  /** The refusal this row can already see, or null while the retirement is offered. */
  disabledReason?: string | null;
}) {
  const button = (
    <Button
      isIconOnly
      aria-label={ariaLabel}
      variant="ghost"
      isDisabled={disabledReason != null}
      className={DANGER_CLASS}
      onPress={onPress}>
      <TrashBin
        className="size-4.5"
        aria-hidden="true"
      />
    </Button>
  );

  // The live control keeps `IconTooltip`: `label` names the act, which is a description rather than a
  // refusal, and a press there opens the delete instead of an explanation.
  return disabledReason != null ? (
    <Hint
      mode="refusal"
      reason={disabledReason}>
      {button}
    </Hint>
  ) : (
    <IconTooltip
      label={label}
      tone="danger">
      {button}
    </IconTooltip>
  );
}

/**
 * The row's ways ELSEWHERE, where it has two or more: six inline icons take 336px of a row that has
 * 631px for everything. One navigation stays inline, a menu of one item costing a press and buying
 * nothing.
 */
export function RowActionMenu({ ariaLabel, children }: { ariaLabel: string; children: ReactNode }) {
  return (
    /* Uncontrolled: `useNavigationClosedOverlay` cannot reach an overlay inside a page — the router
       hides the departed page, Effects and all
       (`fl_frontend/src/features/teams/components/ui/TeamPopoverMenu.tsx`) — and a menu item's own
       `shouldCloseOnSelect` closes this before the route it opens changes. */
    <Dropdown>
      {/* One label for every row and every list, so the trigger names the same control everywhere;
          `ariaLabel` is what says whose row it belongs to. */}
      <IconTooltip label="Weitere Aktionen">
        <Dropdown.Trigger
          aria-label={ariaLabel}
          className={ACTION_BUTTON_CLASS}>
          <Ellipsis
            className="size-4.5"
            aria-hidden="true"
          />
        </Dropdown.Trigger>
      </IconTooltip>
      {/* `offset` rather than a margin class: it feeds react-aria's positioning maths, so the gap
          survives the menu flipping above a row near the foot of the list. */}
      <Dropdown.Popover
        placement="bottom end"
        offset={8}
        className="w-64 rounded-xl">
        <Dropdown.Menu aria-label={ariaLabel}>{children}</Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/**
 * One way out of the row. Its hover is spelled here rather than left to `globals.css`: a
 * utilities-layer class is what outranks HeroUI's own components-layer `:hover`.
 */
export function RowActionMenuItem({
  id,
  href,
  label,
  external,
  children,
}: {
  id: string;
  href: string;
  label: string;
  external?: boolean;
  children: ReactNode;
}) {
  return (
    <Dropdown.Item
      id={id}
      textValue={label}
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className="data-hovered:bg-hover flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors">
      <Label className="fluid-sm text-foreground min-w-0 flex-1 font-semibold">{label}</Label>
      {children}
    </Dropdown.Item>
  );
}

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}
