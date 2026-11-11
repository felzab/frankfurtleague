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
export const answerRows = tv({
  slots: {
    root: "grid w-full text-sm",
    row: `grid gap-1 py-3 first:pt-0 last:pb-0 ${stacked()}`,
    // A wrapping row, as `Table`'s name line: the name, after its plaque, at its least width, 5 rem, grown to the name
    // and no further, so the chips stand after a short name, a long one is cut beside them down to that least, and a
    // chip the line's own room cannot hold beside it takes the next line.
    head: "flex min-w-20 flex-wrap items-center gap-2",
    // The plaque and the name, which never part; the name's track stops at the room the group has.
    group: "grid max-w-max min-w-0 grow basis-20 auto-cols-max grid-flow-col grid-cols-[minmax(0,max-content)] items-center gap-2",
    name: "min-w-0 truncate font-medium",
    line: "text-xs text-fg-muted",
    reason: "break-words whitespace-pre-line",
  },
  variants: {
    // The plaque's 40 px and its gap besides the name's least.
    plaque: { true: { head: "min-w-32", group: "basis-32 grid-cols-[max-content_minmax(0,max-content)]" } },
  },
});

/**
 * A party's name on its line with its chips, here and on a seat's row (`SeatRows`): a name too long for the line is cut
 * with „…“, so the chips keep their place beside it while the name keeps its least width, and take the next line where
 * it would not.
 */
export function PartyHead({
  name,
  plaque,
  chips,
  muted = false,
}: {
  name: Words;
  plaque?: Plaque;
  chips: ReadonlyArray<ChipProps>;
  /** A place nobody holds: its name muted. */
  muted?: boolean;
}) {
  const s = answerRows({ plaque: plaque !== undefined });
  return (
    <span className={s.head()}>
      <span className={s.group()}>
        {plaque !== undefined && <TeamPlaque plaque={plaque} />}
        <CutText
          text={textOf(name)}
          className={s.name({ class: muted ? "text-fg-muted" : undefined })}
        />
      </span>
      {chips.map((chip) => (
        <Chip
          key={chip.label}
          {...chip}
        />
      ))}
    </span>
  );
}

/**
 * The parties' answers about a record, read-only, inside a box's body: a row a party, its name with its chip, a muted
 * line under it, and its reason on a line of its own, wrapping as long as it runs.
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
          <PartyHead
            name={row.name}
            {...(row.plaque === undefined ? {} : { plaque: row.plaque })}
            chips={[row.chip]}
          />
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
  const s = answerRows({ plaque: true });
  return (
    <div className={s.root()}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={s.row()}>
          <span className={s.head()}>
            <span className={placeholderBar("h-6 w-10")} />
            <PlaceholderLine
              textClass={s.name()}
              widthClass="w-24"
            />
            <span className={placeholderBar("h-5 w-16")} />
          </span>
          <PlaceholderLine
            textClass={s.line()}
            widthClass="w-1/3"
          />
        </div>
      ))}
    </div>
  );
}
