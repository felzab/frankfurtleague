"use client";

// Redesign: goes with its last importer; `kit/Table` replaces it.
import Link from "next/link";

import Copy from "@gravity-ui/icons/Copy";

import { Button } from "@heroui/react/button";

import { benannt } from "@/shared/utils/benannt";
import { focusRow } from "@/shared/utils/focusAfterWrite";

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
