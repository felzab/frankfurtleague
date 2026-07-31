"use client";

import Link from "next/link";

import { Copy, Pencil, TrashBin } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { IconTooltip } from "./IconTooltip";

import type { ReactNode } from "react";

/**
 * The admin tables' row-action cluster. Shared because the two tables' actions were identical down
 * to the class strings — and because the two shapes had drifted apart in a way that was a real
 * interaction bug, not just duplication (R4 §8.4): the `<Link>` actions got a 40×40 hit area, a
 * hover background and a focus ring, while the `<Button>` actions in the same row got none of the
 * three. They share one style here, so the targets match.
 *
 * The data columns are deliberately NOT shared — they genuinely differ per entity, and a
 * config-driven table is where that kind of abstraction stops paying (owner decision, 2026-07-30).
 */
const ACTION_CLASS =
  "text-foreground-muted hover:bg-muted/40 hover:text-brand focus-visible:ring-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2";

const DANGER_CLASS =
  "text-foreground-muted hover:bg-danger/10 hover:text-danger focus-visible:ring-danger flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2";

export function RowActionLink({ href, label, external, children }: { href: string; label: string; external?: boolean; children: ReactNode }) {
  return (
    <IconTooltip label={label}>
      <Link
        href={href}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className={ACTION_CLASS}>
        {children}
      </Link>
    </IconTooltip>
  );
}

export function RowActionCopy({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <IconTooltip label={label}>
      <Button
        isIconOnly
        variant="ghost"
        className={ACTION_CLASS}
        onPress={onPress}>
        <Copy
          width={18}
          height={18}
        />
      </Button>
    </IconTooltip>
  );
}

export function RowActionEdit({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <IconTooltip label={label}>
      <Button
        isIconOnly
        variant="ghost"
        className={ACTION_CLASS}
        onPress={onPress}>
        <Pencil
          width={18}
          height={18}
        />
      </Button>
    </IconTooltip>
  );
}

export function RowActionDelete({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <IconTooltip
      label={label}
      tone="danger">
      <Button
        isIconOnly
        variant="ghost"
        className={DANGER_CLASS}
        onPress={onPress}>
        <TrashBin
          width={18}
          height={18}
        />
      </Button>
    </IconTooltip>
  );
}

/** The container the four actions sit in. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-2">{children}</div>;
}
