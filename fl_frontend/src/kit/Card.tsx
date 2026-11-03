import { textOf } from "@/core/copy";

import { card } from "./cardStyles";
import { Chip } from "./Chip";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";

import type { Copy, Words } from "@/core/copy";
import type { Route } from "next";
import type { ReactElement, ReactNode } from "react";
import type { ChipProps } from "./Chip";

/** A card's props, which its folded form, `CardFold`, takes as they are. */
export type CardProps = {
  /** Catalogue text such as the kind of open work, or a record's own name, such as a club's. */
  title: Words;
  /** How many items the card holds open. */
  count?: number;
  /** The card's one button. */
  action?: ReactElement;
  body?: "rows" | "fields";
  children?: ReactNode;
  /** The one line under the title: catalogue text such as a figure's meaning, or a record's own detail. */
  line?: Words;
};

/**
 * One kind of open work, its count beside its title, its records as rows or its inputs as fields. A card whose
 * body folds behind its head is `CardFold`, a module of its own, so a page placing only plain cards ships none
 * of the fold's client code.
 */
export function Card({ title, count, action, body = "rows", children, line }: CardProps) {
  const s = card({ body });
  return (
    <section className={s.root()}>
      <div className={s.head()}>
        <h2 className={s.title()}>{textOf(title)}</h2>
        {count !== undefined && <span className={s.count()}>{count}</span>}
        {line !== undefined && <span className={s.line()}>{textOf(line)}</span>}
      </div>
      {children !== undefined && <div className={s.body()}>{children}</div>}
      {action !== undefined && <div className={s.foot()}>{action}</div>}
    </section>
  );
}

/**
 * One choice of the chooser: the whole card one link, its title and its line, the chevron at its right.
 * @awaitsProduction the role chooser's page
 */
export function CardLink({ href, title, line }: { href: Route; title: Copy; line: Words }) {
  return (
    <section className={card().root()}>
      <Link
        href={href}
        placement="card">
        <span className="flex items-stretch gap-x-3 px-4 py-3">
          <span className="grid min-w-0 flex-1 gap-1">
            <span className="text-base font-semibold break-words">{title}</span>
            <span className="text-sm text-fg-muted">{textOf(line)}</span>
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
 * @awaitsProduction the Übersicht's cards
 */
export function CardRow({ href, name, chip, detail }: { href: Route; name: Words; chip?: ChipProps; detail?: Words }) {
  return (
    <div className={card().row()}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span
          title={textOf(name)}
          className="min-w-0 truncate">
          <Link
            href={href}
            placement="row"
            label={name}
          />
        </span>
        {chip !== undefined && <Chip {...chip} />}
      </span>
      {detail !== undefined && <span className="flex shrink-0 items-center font-numeric text-fg-muted">{textOf(detail)}</span>}
      <RowEnd />
    </div>
  );
}
