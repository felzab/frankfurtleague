"use client";

// Redesign: goes with its last importer; `kit/Table` replaces it.
import Link from "next/link";

import ArrowRotateLeft from "@gravity-ui/icons/ArrowRotateLeft";
import Copy from "@gravity-ui/icons/Copy";

import { Button } from "@heroui/react/button";

import { benannt } from "@/shared/utils/benannt";
import { focusRow } from "@/shared/utils/focusAfterWrite";

import { FocusSlot } from "./FocusSlot";
import { Hint } from "./Hint";
import { IconTooltip } from "./IconTooltip";
import { ROW_ACTION_SIZE_CLASSES } from "./rowActionSize";

import type { ReactNode } from "react";

/**
 * The shape every row action shares, so a link's hit area and a button's cannot drift; only the hover arm splits. The
 * tooltip only describes the control, so each is named by its `label` and then the row's `subject`.
 */
const ACTION_SHAPE_CLASSES = `flex text-foreground-muted ${ROW_ACTION_SIZE_CLASSES} shrink-0 items-center justify-center rounded-xl transition-colors`;

const ACTION_LINK_CLASSES = `${ACTION_SHAPE_CLASSES} hover:bg-hover hover:text-brand`;

const ACTION_BUTTON_CLASSES = `${ACTION_SHAPE_CLASSES} data-hovered:bg-hover data-hovered:text-brand`;

export function RowActionLink({ href, label, subject, children }: { href: string; label: string; subject: string; children: ReactNode }) {
  return (
    <IconTooltip label={label}>
      <Link
        href={href}
        aria-label={benannt(label, subject)}
        className={ACTION_LINK_CLASSES}>
        {children}
      </Link>
    </IconTooltip>
  );
}

export function RowActionCopy({ label, subject, onPress }: { label: string; subject: string; onPress: () => void }) {
  return (
    <IconTooltip label={label}>
      <Button
        isIconOnly
        aria-label={benannt(label, subject)}
        variant="ghost"
        className={ACTION_BUTTON_CLASSES}
        onPress={onPress}>
        <Copy
          className="size-4.5"
          aria-hidden="true"
        />
      </Button>
    </IconTooltip>
  );
}

/** The place a retirement and its reactivation share, so a landed write hands the focus from one to the other. */
const RETIREMENT_PLACE = "stilllegung";

/** Shown in `RowActionDelete`'s place on a retired row. No confirmation step: one press of the delete reverses it. */
export function RowActionRestore({
  label,
  subject,
  onPress,
  disabledReason,
  isPending = false,
  place = RETIREMENT_PLACE,
}: {
  label: string;
  /** What the row is, which the name carries after `label`: one name per row, where `label` repeats down the list. */
  subject: string;
  /** Handed the pressed control, which a landing anchors on: a grid row takes the focus off a control pressed without a pointer. */
  onPress: (pressed: Element) => void;
  /** A restore no delete stands in for, as the squad row's beside the person's, names a place of its own. */
  place?: string;
  /**
   * The refusal this row can already see, or null while the return is offered. Offering what the endpoint refuses is one
   * defect whichever control reaches it, and a list reaches the squad row's reactivate as its editor does.
   */
  disabledReason?: string | null;
  /** While the write runs, so a second press cannot send it twice. Never a `disabledReason`: nothing refuses the row. */
  isPending?: boolean;
}) {
  const name = benannt(label, subject);
  const button = (
    <Button
      isIconOnly
      aria-label={name}
      variant="ghost"
      isDisabled={disabledReason != null}
      // `isPending` and never `isDisabled`: a disabled button leaves the tab order, dropping the keyboard's focus to the
      // page mid-press, where react-aria's pending state keeps it and ignores the press.
      isPending={isPending}
      className={ACTION_BUTTON_CLASSES}
      onPress={(event) => onPress(event.target)}>
      <ArrowRotateLeft
        className="size-4.5"
        aria-hidden="true"
      />
    </Button>
  );

  return (
    <FocusSlot name={place}>
      {disabledReason != null ? (
        <Hint
          mode="refusal"
          reason={disabledReason}
          label={name}>
          {button}
        </Hint>
      ) : (
        <IconTooltip label={label}>{button}</IconTooltip>
      )}
    </FocusSlot>
  );
}

export function RowActions({
  row,
  children,
}: {
  /** The entity's id where a press in the row writes: the landing finds the row again by it after the refresh. */
  row?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-center justify-end gap-2"
      {...(row === undefined ? {} : focusRow(row))}>
      {children}
    </div>
  );
}
