import { COPY } from "@/core/copy/shared";

import { cardHover, cardSurface, stacked } from "./cardStyles";
import { Icon } from "./Icon";
import { formColumn, RailPage } from "./RailFrame";
import { RowEnd } from "./RowEnd";
import { tv } from "./tv";
import { NavigationLink } from "./WholePage";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactNode } from "react";
import type { IconName } from "./Icon";

type AccountRoute = "account" | "accountSignIn" | "accountSecurity" | "accountAppearance" | "accountEntries";

export function AccountPage({ route, children }: { route: AccountRoute; children: ReactNode }) {
  return (
    <RailPage
      scope="area"
      title={{ route }}>
      <div className={formColumn()}>{children}</div>
    </RailPage>
  );
}

export type AccountEntry = { id: string; label: Copy; icon: IconName; href: Route };

const list = tv({
  slots: {
    root: cardSurface({ class: "overflow-hidden" }),
    row: `flex h-14 items-center gap-3 ${stacked()} px-4 text-sm font-medium text-fg ${cardHover()}`,
    glyph: "text-fg-muted",
    words: "min-w-0 flex-1 truncate",
  },
});

/** Konto's pages as the phone opens on them, each row the link to its page. */
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
