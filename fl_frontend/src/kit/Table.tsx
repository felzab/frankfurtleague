import { tv } from "tailwind-variants/lite";

import { Chip } from "./Chip";
import { EmptyState } from "./EmptyState";
import { Link } from "./Link";
import { TeamPlaque } from "./TeamPlaque";

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

export type TableRow = {
  id: string;
  /** The record's name; with `href` the whole row opens the record. */
  name: string;
  href?: Route;
  /** A club's plaque before its name. */
  plaque?: { kuerzel: string } | { quelle: string };
  chip?: ChipProps;
  /** The row's values, by column key; a missing value leaves its cell empty. */
  cells: Readonly<Record<string, string>>;
  /** Places 1 and 2: the 2-px brand bar at the row's left edge. */
  qualifies?: boolean;
  /** A row that no longer counts, such as a disqualified team's: its text muted. */
  muted?: boolean;
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
};

const table = tv({
  slots: {
    head: "h-10 bg-bg-surface px-3 text-xs font-medium tracking-[0.04em] whitespace-nowrap text-fg-muted uppercase",
    row: "relative h-14 border-t border-border first:border-t-0 lg:h-13",
    cell: "px-3 whitespace-nowrap",
    // The name takes the room the facts leave and wraps where it is long, never narrower than 192 px, so a
    // long fact beside it cannot squeeze it to a letter a line.
    name: "w-full max-w-0 min-w-48 px-3 py-2 break-words",
  },
  variants: {
    align: {
      start: { head: "text-start", cell: "text-start" },
      end: { head: "text-end", cell: "text-end" },
      centre: { head: "w-11 text-center", cell: "w-11 text-center text-fg-muted" },
    },
    figures: {
      true: { cell: "font-numeric tabular-nums" },
    },
    strong: {
      true: { cell: "font-semibold" },
    },
    phone: {
      hidden: { head: "max-lg:hidden", cell: "max-lg:hidden" },
      shown: {},
    },
    linked: {
      true: { row: "transition-colors duration-(--motion-state) hover:bg-bg-surface" },
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

function NameCell({ row, barred }: { row: TableRow; barred: boolean }) {
  return (
    <td className={table({ qualifies: barred }).name()}>
      {/* A long name wraps, its chip following onto the next line; the plaque and the chip keep their size. */}
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        {row.plaque !== undefined && <TeamPlaque {...row.plaque} />}
        <span className="min-w-0">
          {row.href === undefined ? (
            row.name
          ) : (
            <Link
              href={row.href}
              placement="row"
              text={row.name}
            />
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
 * A list of records: rows 52 px high on desktop and 56 on a phone, lines between them, under a grey
 * capital head. A row opens its record. Few columns: the name with its plaque and chip, then a few facts.
 */
export function Table({ label, nameLabel, rankLabel, columns, rows, empty }: TableProps) {
  const nameHead = table({ align: "start" }).head();
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-bg">
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
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const marks = { linked: row.href !== undefined, muted: row.muted === true };
              return (
                <tr
                  key={row.id}
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
                      {row.cells[column.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
