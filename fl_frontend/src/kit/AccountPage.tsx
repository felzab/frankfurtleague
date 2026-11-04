import NextLink from "next/link";

import { COPY } from "@/core/copy";

import { cardSurface, stacked } from "./cardStyles";
import { EmptyState } from "./EmptyState";
import { Icon } from "./Icon";
import { PageWait } from "./PageFade";
import { formColumn, RailPage } from "./RailFrame";
import { RowEnd } from "./RowEnd";
import { Skeleton } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { IconName } from "./Icon";
import type { SkeletonShape } from "./Skeleton";

/** Konto's pages, by their routes: its list, and the four the list and the rail lead to. */
type AccountRoute = "account" | "accountSignIn" | "accountSecurity" | "accountAppearance" | "accountEntries";

/**
 * The skeleton each page waits in, shaped like its final box: the list's one box of rows, Darstellung's one row-high
 * box, and the boxes with a footer for the rest.
 */
const WAIT: Readonly<Record<AccountRoute, SkeletonShape>> = {
  account: "list",
  accountSignIn: "sections",
  accountSecurity: "sections",
  accountAppearance: "box",
  accountEntries: "sections",
};

/**
 * A Konto page: its title in the strip and its boxes one under another in the 760-px column, each an `AccountBox`.
 * The boxes are read in the template's one boundary, the column holding the boxes' skeleton meanwhile, so the title
 * stands at once.
 */
export function AccountPage({ route, children }: { route: AccountRoute; children: ReactNode }) {
  return (
    <RailPage
      scope="area"
      title={{ route }}>
      <div className={formColumn()}>
        <PageWait fallback={<Skeleton shape={WAIT[route]} />}>{children}</PageWait>
      </div>
    </RailPage>
  );
}

/** A Konto page holding none of the records its boxes would show: the blank slate in one box, the page's own mark over it. */
export function AccountEmpty({ plural, glyph }: { plural: Copy; glyph: IconName }) {
  return (
    <div className={cardSurface()}>
      <EmptyState
        kind="none"
        plural={plural}
        glyph={glyph}
      />
    </div>
  );
}

/** One of Konto's pages as its list names it: the rail's entry, its glyph and its words. */
export type AccountEntry = { id: string; label: Copy; icon: IconName; href: Route };

const list = tv({
  slots: {
    root: cardSurface({ class: "overflow-hidden" }),
    row: `flex h-14 items-center gap-3 ${stacked()} px-4 text-sm font-medium text-fg`,
    glyph: "text-fg-muted",
    words: "min-w-0 flex-1 truncate",
  },
});

/**
 * Konto's pages as the phone opens on them: one box of rows, each the page's rail glyph, its name and the chevron,
 * the whole row the link, as a card's rows lead on.
 */
export function AccountList({ entries }: { entries: ReadonlyArray<AccountEntry> }) {
  const slots = list();
  return (
    <nav
      aria-label={COPY.template.account}
      className={slots.root()}>
      {entries.map((entry) => (
        <NextLink
          key={entry.id}
          href={entry.href}
          data-kit-focus="inset"
          className={slots.row()}>
          <span className={slots.glyph()}>
            <Icon
              glyph={entry.icon}
              size={18}
            />
          </span>
          <span className={slots.words()}>{entry.label}</span>
          <RowEnd />
        </NextLink>
      ))}
    </nav>
  );
}
