import { textOf } from "@/core/copy";

import { nameWithChips, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { EmptyState } from "./EmptyState";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ChipProps } from "./Chip";
import type { EmptyStateProps } from "./EmptyState";
import type { Plaque } from "./TeamPlaque";

export type AnswerRow = {
  id: string;
  name: Words;
  plaque?: Plaque;
  chip: ChipProps;
  /** The muted line under the name: the answer's date and what it proposes, or when an answer is due. */
  line: Words;
  /** The party's reason in its own words, which keeps the line breaks it was written with. */
  reason?: Words;
};

// The name's and the line's sizes are a `Card` row's, so a party reads alike on the Übersicht and here.
const answerRows = tv({
  slots: {
    root: "grid w-full text-sm",
    row: `grid gap-1 py-3 first:pt-0 last:pb-0 ${stacked()}`,
    line: "text-xs text-fg-muted",
    reason: "break-words whitespace-pre-line",
  },
});

const PARTY_CLASSES = "flex min-w-0 items-center gap-2";

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
  const s = nameWithChips({ card: true, led: true });
  return (
    <span className={PARTY_CLASSES}>
      {plaque !== undefined && <TeamPlaque plaque={plaque} />}
      <span className={s.line()}>
        <span className={s.head()}>
          <CutText
            text={textOf(name)}
            className={s.name({ class: muted ? "text-fg-muted" : undefined })}
          />
        </span>
        {chips.length > 0 && (
          <span className={s.chips()}>
            {chips.map((chip) => (
              <Chip
                key={chip.label}
                {...chip}
              />
            ))}
          </span>
        )}
      </span>
    </span>
  );
}

/** The parties' answers about a record, read-only, inside a box's body. */
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
