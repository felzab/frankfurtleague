"use client";

import Link from "next/link";

import { ArrowRotateLeft, Copy, Pencil, TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { DisabledHint } from "./DisabledHint";
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
 * The shape stays one string for that reason; only the hover variant splits, because a `<Link>` emits
 * no `data-hovered` and on a `Button` a plain `:hover` sticks after a tap. Both arms carry one tone.
 *
 * The data columns are deliberately NOT shared — they genuinely differ per entity, and a
 * config-driven table is where that kind of abstraction stops paying (decided 2026-07-30).
 *
 * `label` and `ariaLabel` are two different things and both are required. `label` is the
 * tooltip, which react-aria wires as `aria-describedby` — a description, announced after the name
 * and dropped entirely by screen readers in forms mode. It never names the control. `ariaLabel`
 * carries the record name so the icons in a row are distinguishable from each other and from the
 * same icons in every other row.
 *
 * Neither class carries a focus style. The `<Button>` actions take HeroUI's ring and the `<Link>`
 * actions take the matching base-layer outline, both in `var(--focus)` — a per-site ring here is
 * what made the row actions look different from everything else.
 */
const ACTION_SHAPE = `text-foreground-muted flex ${ROW_ACTION_SIZE} shrink-0 items-center justify-center rounded-xl transition-colors`;

const ACTION_LINK_CLASS = `${ACTION_SHAPE} hover:bg-hover hover:text-brand`;

const ACTION_BUTTON_CLASS = `${ACTION_SHAPE} data-hovered:bg-hover data-hovered:text-brand`;

/**
 * `disabled:pointer-events-none` is load-bearing rather than cosmetic: a disabled form control
 * dispatches no pointer event and the event reaches no ancestor either, so `DisabledHint`'s wrapper
 * only becomes the hit target once this makes the button transparent to the pointer.
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

/**
 * Brings a soft-deleted row back — the counterpart to `RowActionDelete`, shown in its
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

/**
 * `disabledReason` is what disables the control, rather than a boolean beside a reason: a row that can
 * see a refusal can always say it, and the two cannot drift apart if there is only one prop. It reaches
 * a phone, which `IconTooltip` cannot — see `DisabledHint`.
 */
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
