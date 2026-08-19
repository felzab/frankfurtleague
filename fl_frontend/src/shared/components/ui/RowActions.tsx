"use client";

import Link from "next/link";

import { ArrowRotateLeft, Copy, Pencil, TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { DisabledHint } from "./DisabledHint";
import { IconTooltip } from "./IconTooltip";
import { ROW_ACTION_SIZE } from "./rowActionSize";

import type { ReactNode } from "react";

/**
 * The shape every row action shares, so a link's hit area and a button's cannot drift; only the hover arm splits. The
 * tooltip is wired as `aria-describedby`, which never names the control, so every action takes an `ariaLabel` too.
 */
const ACTION_SHAPE = `text-foreground-muted flex ${ROW_ACTION_SIZE} shrink-0 items-center justify-center rounded-xl transition-colors`;

const ACTION_LINK_CLASS = `${ACTION_SHAPE} hover:bg-hover hover:text-brand`;

const ACTION_BUTTON_CLASS = `${ACTION_SHAPE} data-hovered:bg-hover data-hovered:text-brand`;

/**
 * `disabled:pointer-events-none` is load-bearing: a disabled control dispatches no pointer event and none reaches an
 * ancestor either, so `DisabledHint`'s wrapper is the hit target only once this makes the button transparent.
 */
const DANGER_CLASS = `${ACTION_SHAPE} data-hovered:bg-hover-danger data-hovered:text-danger-strong disabled:pointer-events-none`;

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
          aria-hidden="true"
          width={18}
          height={18}
        />
      </Button>
    </IconTooltip>
  );
}

export function RowActionEdit({ label, ariaLabel, onPress }: { label: string; ariaLabel: string; onPress: () => void }) {
  return (
    <IconTooltip label={label}>
      <Button
        isIconOnly
        aria-label={ariaLabel}
        variant="ghost"
        className={ACTION_BUTTON_CLASS}
        onPress={onPress}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </Button>
    </IconTooltip>
  );
}

/** Shown in `RowActionDelete`'s place on a retired row. No confirmation step: one press of the delete reverses it. */
export function RowActionRestore({ label, ariaLabel, onPress }: { label: string; ariaLabel: string; onPress: () => void }) {
  return (
    <IconTooltip label={label}>
      <Button
        isIconOnly
        aria-label={ariaLabel}
        variant="ghost"
        className={ACTION_BUTTON_CLASS}
        onPress={onPress}>
        <ArrowRotateLeft
          aria-hidden="true"
          width={18}
          height={18}
        />
      </Button>
    </IconTooltip>
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
        aria-hidden="true"
        width={18}
        height={18}
      />
    </Button>
  );

  // The live control keeps `IconTooltip`: `label` names the act, which is a description rather than a
  // refusal, and a press there opens the delete instead of an explanation.
  return disabledReason != null ? (
    <DisabledHint reason={disabledReason}>{button}</DisabledHint>
  ) : (
    <IconTooltip
      label={label}
      tone="danger">
      {button}
    </IconTooltip>
  );
}

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}
