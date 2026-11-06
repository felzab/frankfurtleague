import { textOf } from "@/core/copy";

import { stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { EmptyState } from "./EmptyState";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ChipProps } from "./Chip";
import type { EmptyStateProps } from "./EmptyState";
import type { Plaque } from "./TeamPlaque";

/** One party's answer: who, where the answer stands, and what the party said beyond it. */
export type AnswerRow = {
  id: string;
  name: Words;
  /** A club's plaque before its name. */
  plaque?: Plaque;
  chip: ChipProps;
  /** The muted line under the name: the answer's date and what it proposes, or when an answer is due. */
  line: Words;
  /** The party's reason in its own words, which keeps the line breaks it was written with. */
  reason?: Words;
};

// The name's and the line's sizes are a `Card` row's, so a party reads alike on the Übersicht and here. The hairline
// stands inside the box's padding, 12 px clear on each side, and the first and last rows take the padding as their own.
const answerRows = tv({
  slots: {
    root: "grid w-full text-sm",
    row: `grid gap-1 py-3 first:pt-0 last:pb-0 ${stacked()}`,
    head: "flex min-w-0 items-center gap-2",
    name: "min-w-0 truncate font-medium",
    line: "text-xs text-fg-muted",
    reason: "break-words whitespace-pre-line",
  },
});

/**
 * The parties' answers about a record, read-only, inside a box's body: a row a party, its name with its chip, a muted
 * line under it, and its reason on a line of its own, wrapping as long as it runs. A name too long for its line is cut
 * with „…“, so the chip keeps its place beside it.
 */
export function AnswerRows({ label, rows, empty }: { label: Copy; rows: ReadonlyArray<AnswerRow>; empty: EmptyStateProps }) {
  const s = answerRows();
  if (rows.length === 0) return <EmptyState {...empty} />;
  return (
    <ul
      aria-label={label}
      className={s.root()}>
      {rows.map((row) => (
        <li
          key={row.id}
          className={s.row()}>
          <span className={s.head()}>
            {row.plaque !== undefined && <TeamPlaque plaque={row.plaque} />}
            <CutText
              text={textOf(row.name)}
              className={s.name()}
            />
            <Chip {...row.chip} />
          </span>
          <span className={s.line()}>{textOf(row.line)}</span>
          {row.reason !== undefined && <p className={s.reason()}>{textOf(row.reason)}</p>}
        </li>
      ))}
    </ul>
  );
}

/**
 * The answers while they are read: `rows` parties, each a plaque, a name and a chip over the muted line. A reason is one
 * party's decline, which the read alone knows, so no row draws one.
 */
export function AnswerRowsPlaceholder({ rows }: { rows: number }) {
  const s = answerRows();
  return (
    <div className={s.root()}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={s.row()}>
          <span className={s.head()}>
            <span className={placeholderBar("h-6 w-10")} />
            <PlaceholderLine
              text={s.name()}
              width="w-24"
            />
            <span className={placeholderBar("h-5 w-16")} />
          </span>
          <PlaceholderLine
            text={s.line()}
            width="w-1/3"
          />
        </div>
      ))}
    </div>
  );
}
