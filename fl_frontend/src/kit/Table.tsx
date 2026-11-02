import { COPY } from "@/core/copy";

import { cardHover, cardSurface } from "./cardStyles";
import { Chip } from "./Chip";
import { EmptyState } from "./EmptyState";
import { Link } from "./Link";
import { RowEnd } from "./RowEnd";
import { TargetMark } from "./TargetMark";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { Route } from "next";
import type { ChipProps } from "./Chip";
import type { EmptyStateProps } from "./EmptyState";

/** A column after the name: its head, and how its values set. */
type TableColumn = {
  key: string;
  label: Copy;
  /** Figures, set in Inter with columns that line up and to the right. */
  figures?: boolean;
  /** The column that decides, such as points: its figures in the strong weight. */
  strong?: boolean;
  /** Left out on a phone, where the row keeps its name and two facts. */
  hideOnPhone?: boolean;
};

/**
 * A cell's value: its text, or a figure some of the club's fixtures left short, such as its count of matches
 * while some were called off, carrying the mark that says how many, which its name tells a screen reader and
 * no line explains.
 */
type TableCell = string | { value: string; cancelled: number };

export type TableRow = {
  id: string;
  /** The record's name; with `href` the whole row opens the record. */
  name: string;
  href?: Route;
  /** A club's plaque before its name. */
  plaque?: { kuerzel: string } | { quelle: string };
  chip?: ChipProps;
  /** The row's values, by column key; a missing value leaves its cell empty. */
  cells: Readonly<Record<string, TableCell>>;
  /** Places 1 and 2: the 2-px brand bar at the row's left edge. */
  qualifies?: boolean;
  /** A row that no longer counts, such as a disqualified team's: its text muted. */
  muted?: boolean;
  /** The row's fragment, so a link elsewhere, such as a club's line in a match head, opens the page at it. */
  anchor?: string;
};

export type TableProps = {
  /** The table's name. */
  label: Copy;
  /** The name column's head. */
  nameLabel: Copy;
  /** A leading rank column, its head; each row's place is its position. */
  rankLabel?: Copy;
  columns: ReadonlyArray<TableColumn>;
  rows: ReadonlyArray<TableRow>;
  /** What stands in the rows' place when there are none. */
  empty: EmptyStateProps;
  /** The rows alone, without the table's own box, inside a card's body, whose box already holds them. */
  bare?: boolean;
};

const table = tv({
  slots: {
    // Small muted capitals over the head row's hairline on the card's own fill: a card's head is the one band
    // it carries, so the column heads never compete with it.
    head: "h-10 px-3 text-xs font-medium tracking-caps whitespace-nowrap text-fg-muted uppercase",
    // A row a link may point to by its fragment, marked while the address names it.
    row: "kit-target relative h-14 border-t border-border first:border-t-0 lg:h-13",
    cell: "px-3 whitespace-nowrap",
    // The name takes the room the facts leave and is cut with „…“ where it is longer (`max-w-0` lets a cell
    // of an automatic table layout shrink below its content, so the cut can happen at all).
    name: "w-full max-w-0 px-3 py-2",
    // A club's name beside its plaque, read but not drawn on a phone, where the plaque stands for it alone.
    clubName: "ms-2 max-lg:sr-only",
    // A linked row's last cell, as narrow as the chevron that says the row leads on.
    end: "w-0 pe-3",
  },
  variants: {
    align: {
      start: { head: "text-start", cell: "text-start" },
      end: { head: "text-end", cell: "text-end" },
      centre: { head: "w-11 text-center", cell: "w-11 text-center text-fg-muted" },
    },
    figures: {
      true: { cell: "font-numeric" },
    },
    strong: {
      true: { cell: "font-semibold" },
    },
    phone: {
      hidden: { head: "max-lg:hidden", cell: "max-lg:hidden" },
      shown: {},
    },
    linked: {
      true: { row: cardHover() },
    },
    muted: {
      true: { row: "text-fg-muted" },
    },
    qualifies: {
      // Drawn inside the first cell, so it takes no width and moves nothing.
      true: { cell: "shadow-[inset_2px_0_0_var(--brand)]", name: "shadow-[inset_2px_0_0_var(--brand)]" },
    },
  },
});

/**
 * A cell's value. In a column where some row's figure is short of fixtures called off, every row keeps the
 * mark's slot at the figure's end, so the digits stand under each other whether a row carries the mark or
 * not; the mark, a red „+N“, is centred on the figure's top-right corner, over the slot and clear of the
 * digits, and its name tells a screen reader what no line explains.
 */
function Cell({ cell, slot }: { cell: TableCell | undefined; slot: boolean }) {
  if (cell === undefined) return null;
  const { value, cancelled } = typeof cell === "string" ? { value: cell, cancelled: 0 } : cell;
  if (!slot) return value;
  return (
    <span className="inline-block pe-2">
      <span className="relative inline-block">
        {value}
        {cancelled > 0 && (
          <span
            aria-hidden
            className="absolute end-0 top-0 translate-x-1/2 -translate-y-1/2 text-xs leading-none font-semibold text-danger">
            {COPY.shared.season.cancelledMark(cancelled)}
          </span>
        )}
      </span>
      {cancelled > 0 && <span className="sr-only">{COPY.shared.season.cancelled(cancelled)}</span>}
    </span>
  );
}

/**
 * The name, cut with „…“ where its column is too narrow and whole in its `title`, then the chip, which keeps
 * its size and its line. A club's plaque stands before its name inside the row's link, so on a phone, where
 * the plaque alone is drawn, the link still opens the club and is named by the club's full name.
 */
function NameCell({ row, barred }: { row: TableRow; barred: boolean }) {
  const s = table({ qualifies: barred });
  const words =
    row.plaque === undefined ? (
      row.name
    ) : (
      <>
        <TeamPlaque {...row.plaque} />
        <span className={s.clubName()}>{row.name}</span>
      </>
    );
  return (
    <td className={s.name()}>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="min-w-0 truncate"
          title={row.name}>
          {row.href === undefined ? (
            words
          ) : (
            <Link
              href={row.href}
              placement="row">
              {words}
            </Link>
          )}
        </span>
        {row.chip !== undefined && (
          <Chip
            tone={row.chip.tone}
            label={row.chip.label}
          />
        )}
      </span>
    </td>
  );
}

/**
 * A list of records: rows 52 px high on desktop and 56 on a phone, lines between them, under a head of
 * muted capitals. A row opens its record, a chevron at its end saying so. Few columns: the name with its plaque
 * and chip, then a few facts.
 */
export function Table({ label, nameLabel, rankLabel, columns, rows, empty, bare = false }: TableProps) {
  const nameHead = table({ align: "start" }).head();
  const isLinked = rows.some((row) => row.href !== undefined);
  // The columns where some row carries the mark of fixtures called off, whose every row keeps its slot.
  const marked = new Set(columns.filter((column) => rows.some((row) => typeof row.cells[column.key] === "object")).map((column) => column.key));
  return (
    <div className={bare ? "overflow-x-auto" : cardSurface({ class: "overflow-x-auto" })}>
      {rows.some((row) => row.anchor !== undefined) && <TargetMark />}
      {rows.length === 0 ? (
        <EmptyState {...empty} />
      ) : (
        <table
          aria-label={label}
          className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              {rankLabel !== undefined && (
                <th
                  scope="col"
                  className={table({ align: "centre" }).head()}>
                  {rankLabel}
                </th>
              )}
              <th
                scope="col"
                className={nameHead}>
                {nameLabel}
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={table({
                    align: column.figures === true ? "end" : "start",
                    phone: column.hideOnPhone === true ? "hidden" : "shown",
                  }).head()}>
                  {column.label}
                </th>
              ))}
              {/* The chevrons' column names nothing, so its head is no header cell. */}
              {isLinked && <td className={table().head()} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const marks = { linked: row.href !== undefined, muted: row.muted === true };
              return (
                <tr
                  key={row.id}
                  id={row.anchor}
                  className={table(marks).row()}>
                  {rankLabel !== undefined && (
                    <td className={table({ align: "centre", figures: true, qualifies: row.qualifies === true }).cell()}>{index + 1}</td>
                  )}
                  <NameCell
                    row={row}
                    barred={rankLabel === undefined && row.qualifies === true}
                  />
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={table({
                        align: column.figures === true ? "end" : "start",
                        figures: column.figures === true,
                        strong: column.strong === true,
                        phone: column.hideOnPhone === true ? "hidden" : "shown",
                      }).cell()}>
                      <Cell
                        cell={row.cells[column.key]}
                        slot={marked.has(column.key)}
                      />
                    </td>
                  ))}
                  {isLinked && <td className={table().end()}>{row.href !== undefined && <RowEnd />}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
