import { COPY } from "@/core/copy";

import { cardHover, cardSurface, stacked } from "./cardStyles";
import { EmptyBox } from "./EmptyState";
import { Icon } from "./Icon";
import { formColumn, RailPage } from "./RailFrame";
import { RowEnd } from "./RowEnd";
import { placeholderBar, PlaceholderLine, Waiting } from "./Skeleton";
import { tv } from "./tv";
import { NavigationLink, PageWait } from "./WholePage";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { IconName } from "./Icon";

/** Konto's pages, by their routes: its list, and the four the list and the rail lead to. */
type AccountRoute = "account" | "accountSignIn" | "accountSecurity" | "accountAppearance" | "accountEntries";

/**
 * A Konto page: its title in the strip and its boxes one under another in the 760-px column, each an `AccountBox`.
 * The boxes are read in the template's one boundary, the column holding meanwhile the placeholders the page names in
 * `wait`, its own boxes' (`AccountBoxPlaceholder`) or its list's (`AccountListPlaceholder`) in their order, so the
 * title stands at once. The page places them as it places the boxes, from the box's own module, which Konto's pages
 * alone import. `waitOnceRead` is the wait as a first read shapes it, for a box the reader's role decides, `wait`
 * standing until it answers.
 */
export function AccountPage({
  route,
  wait,
  waitOnceRead,
  children,
}: {
  route: AccountRoute;
  wait: ReactNode;
  waitOnceRead?: Promise<ReactNode>;
  children: ReactNode;
}) {
  const waiting = (boxes: ReactNode) => <Waiting layoutClass="grid gap-6">{boxes}</Waiting>;
  return (
    <RailPage
      scope="area"
      title={{ route }}>
      <div className={formColumn()}>
        <PageWait fallback={waiting(wait)}>
          {waitOnceRead === undefined ? children : <WaitOnceRead wait={waitOnceRead.then(waiting)}>{children}</WaitOnceRead>}
        </PageWait>
      </div>
    </RailPage>
  );
}

/**
 * The boxes in a wait a first read shapes, the page's own `wait` standing until that read answers. The static shell
 * draws `wait` knowing no reader, and it is what an ordinary load shows: React reveals no streamed boundary within
 * 300 ms of the first paint (`$RC` in its Fizz runtime), so reads landing inside that are revealed as one and the shaped
 * wait never stands; it serves a load whose boxes outlast that alone. A box only one role holds therefore belongs in no
 * wait.
 */
async function WaitOnceRead({ wait, children }: { wait: Promise<ReactNode>; children: ReactNode }) {
  return <PageWait fallback={await wait}>{children}</PageWait>;
}

/** A Konto page holding none of the records its boxes would show: the blank slate in one box, the page's own mark over it. */
export function AccountEmpty({ plural, glyph }: { plural: Copy; glyph: IconName }) {
  return (
    <EmptyBox
      kind="none"
      plural={plural}
      glyph={glyph}
    />
  );
}

/** One of Konto's pages as its list names it: the rail's entry, its glyph and its words. */
export type AccountEntry = { id: string; label: Copy; icon: IconName; href: Route };

const list = tv({
  slots: {
    root: cardSurface({ class: "overflow-hidden" }),
    row: `flex h-14 items-center gap-3 ${stacked()} px-4 text-sm font-medium text-fg ${cardHover()}`,
    glyph: "text-fg-muted",
    words: "min-w-0 flex-1 truncate",
  },
});

/**
 * Konto's list while the session is judged: the list's own box with a row for each of the pages every person holds and
 * Deine Einträge, each its glyph and its name's line as bars beside the chevron.
 */
export function AccountListPlaceholder() {
  const slots = list();
  return (
    <div className={slots.root()}>
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className={slots.row()}>
          <span className={placeholderBar("size-4.5")} />
          <PlaceholderLine
            textClass={slots.words()}
            widthClass="w-1/3"
          />
          <RowEnd />
        </span>
      ))}
    </div>
  );
}

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
        <NavigationLink
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
        </NavigationLink>
      ))}
    </nav>
  );
}
