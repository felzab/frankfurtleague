"use client";

import Link from "next/link";

import { ArrowRotateLeft, Copy, Pencil, TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { IconTooltip } from "./IconTooltip";
import { ROW_ACTION_SIZE } from "./rowActionSize";

import type { ReactNode } from "react";

/**
 * The admin tables' row-action cluster. Shared because the two tables' actions were identical down
 * to the class strings — and because the two shapes had drifted apart in a way that was a real
 * interaction bug, not just duplication: the `<Link>` actions got a 40×40 hit area, a
 * hover background and a focus ring, while the `<Button>` actions in the same row got none of the
 * three. They share one style here, so the targets match.
 *
 * The data columns are deliberately NOT shared — they genuinely differ per entity, and a
 * config-driven table is where that kind of abstraction stops paying (decided 2026-07-30).
 *
 * `label` and `ariaLabel` are two different things and both are required. `label` is the
 * tooltip, which react-aria wires as `aria-describedby` — a description, announced after the name
 * and dropped entirely by screen readers in forms mode. It never names the control. `ariaLabel`
 * carries the record name so the five icons in a row are distinguishable from each other and from
 * the same five icons in every other row.
 *
 * Neither class carries a focus style. The `<Button>` actions take HeroUI's ring and the `<Link>`
 * actions take the matching base-layer outline, both in `var(--focus)` — a per-site ring here is
 * what made the row actions look different from everything else.
 */
const ACTION_CLASS = `text-foreground-muted hover:bg-muted/40 hover:text-brand flex ${ROW_ACTION_SIZE} shrink-0 items-center justify-center rounded-xl transition-colors`;

const DANGER_CLASS = `text-foreground-muted hover:bg-danger/10 hover:text-danger flex ${ROW_ACTION_SIZE} shrink-0 items-center justify-center rounded-xl transition-colors`;

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
        className={ACTION_CLASS}>
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
        className={ACTION_CLASS}
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
        className={ACTION_CLASS}
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

/**
 * Brings a soft-deleted row back (ADR-0025) — the counterpart to `RowActionDelete`, shown in its
 * place on a retired row. A single press, no confirmation step: unlike the delete it undoes, the
 * action is reversed by one press of the delete beside it.
 */
export function RowActionRestore({ label, ariaLabel, onPress }: { label: string; ariaLabel: string; onPress: () => void }) {
  return (
    <IconTooltip label={label}>
      <Button
        isIconOnly
        aria-label={ariaLabel}
        variant="ghost"
        className={ACTION_CLASS}
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

export function RowActionDelete({
  label,
  ariaLabel,
  onPress,
  isDisabled,
}: {
  label: string;
  ariaLabel: string;
  onPress: () => void;
  /**
   * For a refusal this row can already see. The tooltip carries the reason, so `label` is what changes —
   * a disabled control with the same wording as a live one tells the reader nothing (decided 2026-08-08).
   */
  isDisabled?: boolean;
}) {
  return (
    <IconTooltip
      label={label}
      tone={isDisabled ? undefined : "danger"}>
      <Button
        isIconOnly
        aria-label={ariaLabel}
        variant="ghost"
        isDisabled={isDisabled}
        className={DANGER_CLASS}
        onPress={onPress}>
        <TrashBin
          aria-hidden="true"
          width={18}
          height={18}
        />
      </Button>
    </IconTooltip>
  );
}

export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}
