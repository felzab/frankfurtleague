import { Chip } from "./Chip";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { ChipProps } from "./Chip";

/**
 * A box with the hairline and the card corners, its head on the surface colour. Its body is rows, or fields
 * with the card's padding around them.
 */
const card = tv({
  slots: {
    root: "grid overflow-hidden rounded-lg border border-border bg-bg text-fg",
    head: "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-b border-border bg-bg-surface px-4 py-3",
    title: "text-base font-semibold break-words",
    count: "col-start-2 row-start-1 font-numeric text-sm text-fg-muted",
    line: "col-span-2 text-sm text-fg-muted",
    body: "",
    foot: "flex justify-end p-4",
  },
  variants: {
    body: {
      rows: {},
      fields: { body: "p-4" },
    },
  },
});

/** One kind of open work, its count beside its title, its records as rows or its inputs as fields. */
export function Card({
  title,
  count,
  line,
  action,
  body = "rows",
  children,
}: {
  /** The kind of open work. */
  title: Copy;
  /** How many items the card holds open. */
  count?: number;
  /** One line under the title: a figure's meaning, or a record's detail. */
  line?: Copy | string;
  /** The card's one button. */
  action?: ReactElement;
  body?: "rows" | "fields";
  children?: ReactNode;
}) {
  const s = card({ body });
  return (
    <section className={s.root()}>
      <div className={s.head()}>
        <h2 className={s.title()}>{title}</h2>
        {count !== undefined && <span className={s.count()}>{count}</span>}
        {line !== undefined && <span className={s.line()}>{line}</span>}
      </div>
      {children !== undefined && <div className={s.body()}>{children}</div>}
      {action !== undefined && <div className={s.foot()}>{action}</div>}
    </section>
  );
}

/** One choice of the chooser: the whole card one link, its title and its line, the chevron at its right. */
export function CardLink({ href, title, line }: { href: Route; title: Copy; line: Copy | string }) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-bg text-fg">
      <Link
        href={href}
        placement="card">
        <span className="flex items-stretch gap-x-3 px-4 py-3">
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-base font-semibold break-words">{title}</span>
            <span className="text-sm text-fg-muted">{line}</span>
          </span>
          <RowEnd />
        </span>
      </Link>
    </section>
  );
}

/**
 * One record in a card's rows: its name, which wraps where it is long, with its chip, a fact at the right, the
 * whole row a link through its name, the chevron at its end saying so.
 */
export function CardRow({ href, name, chip, detail }: { href: Route; name: string; chip?: ChipProps; detail?: string }) {
  return (
    <div className="relative flex min-h-14 items-stretch gap-3 border-t border-border px-4 py-2 text-sm transition-colors duration-(--motion-state) first:border-t-0 hover:bg-bg-surface lg:min-h-13">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="min-w-0 break-words">
          <Link
            href={href}
            placement="row"
            text={name}
          />
        </span>
        {chip !== undefined && (
          <Chip
            tone={chip.tone}
            label={chip.label}
          />
        )}
      </span>
      {detail !== undefined && <span className="flex shrink-0 items-center font-numeric text-fg-muted">{detail}</span>}
      <RowEnd />
    </div>
  );
}
