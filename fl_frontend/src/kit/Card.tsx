import { CardFold } from "./CardFold";
import { card } from "./cardStyles";
import { Chip } from "./Chip";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { ChipProps } from "./Chip";

/** A card's one line under its title: catalogue text such as a figure's meaning, or a record's own detail. */
type Line = { line: Copy; lineText?: never } | { lineText: string; line?: never };

/** One kind of open work, its count beside its title, its records as rows or its inputs as fields. */
export function Card({
  title,
  count,
  action,
  body = "rows",
  folded,
  children,
  ...props
}: {
  /** The kind of open work. */
  title: Copy;
  /** How many items the card holds open. */
  count?: number;
  /** The card's one button. */
  action?: ReactElement;
  body?: "rows" | "fields";
  /** The body folded behind the head, which opens it. */
  folded?: boolean;
  children?: ReactNode;
} & (Line | { line?: never; lineText?: never })) {
  const line = props.line ?? props.lineText;
  if (folded === true) {
    return (
      <CardFold
        title={title}
        count={count}
        line={line}
        body={body}
        action={action}>
        {children}
      </CardFold>
    );
  }
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
export function CardLink({ href, title, ...props }: { href: Route; title: Copy } & Line) {
  return (
    <section className={card().root()}>
      <Link
        href={href}
        placement="card">
        <span className="flex items-stretch gap-x-3 px-4 py-3">
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-base font-semibold break-words">{title}</span>
            <span className="text-sm text-fg-muted">{props.line ?? props.lineText}</span>
          </span>
          <RowEnd />
        </span>
      </Link>
    </section>
  );
}

/**
 * One record in a card's rows: its name with its chip on one line, a fact at the right, the whole row a link
 * through its name, the chevron at its end saying so. A name too long for the line is cut with „…“ so the
 * chip keeps its place beside it; the full name stays the link's accessible name and shows as its title.
 */
export function CardRow({ href, name, chip, detail }: { href: Route; name: string; chip?: ChipProps; detail?: string }) {
  return (
    <div className={card().row()}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          title={name}
          className="min-w-0 truncate">
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
