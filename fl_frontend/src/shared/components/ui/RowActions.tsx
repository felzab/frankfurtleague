"use client";

// Redesign: goes with its last importer; `kit/Table` replaces it.
import Link from "next/link";

import { benannt } from "@/shared/utils/benannt";
import { focusRow } from "@/shared/utils/focusAfterWrite";

import { IconTooltip } from "./IconTooltip";

import type { ReactNode } from "react";

/** The tooltip only describes the control, so each is named by its `label` and then the row's `subject`. */
const ACTION_LINK_CLASSES =
  "flex size-10 shrink-0 items-center justify-center rounded-xl text-foreground-muted transition-colors hover:bg-hover hover:text-brand";

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
