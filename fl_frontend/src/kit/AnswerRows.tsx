import { textOf } from "@/core/copy";

import { actRow, nameWithChips, stacked } from "./cardStyles";
import { Chip } from "./Chip";
import { CutText } from "./CutText";
import { EmptyState } from "./EmptyState";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { ReactElement } from "react";
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
  /** The acts the league takes on the party's answer, the page's own, one or two kit buttons. */
  acts?: ReactElement;
};

// The name's and the line's sizes are a `Card` row's, so a party reads alike on the Übersicht and here. The list is the
// container its rows' acts read, as a card's rows read the card (`actRow`).
const answerRows = tv({
  slots: {
    root: "@container grid w-full text-sm",
    row: `py-3 first:pt-0 last:pb-0 ${stacked()}`,
    line: "text-xs text-fg-muted",
    reason: "break-words whitespace-pre-line",
  },
});

const PARTY_CLASSES = "flex min-w-0 items-center gap-2";

// A card row's frame without its padding and its least height: the box's body and the row's own `py-3` already space
// the rows, and a row stands as tall as its lines, as it does without acts.
const FRAME_IN_BOX_CLASSES = "min-h-0 p-0 pointer-coarse:min-h-0";

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

/**
 * The parties' answers about a record inside a box's body, each with the acts the league takes on it, where it takes
 * any. The box's width places the acts for every row alike, as a card's does (`actRow`): beside the words from 32 rem,
 * and on one line under them in a narrower box.
 */
export function AnswerRows({ label, rows, empty }: { label: Copy; rows: ReadonlyArray<AnswerRow>; empty: EmptyStateProps }) {
  const s = answerRows();
  const act = actRow({ opens: false });
  if (rows.length === 0) return <EmptyState {...empty} />;
  return (
    <ul
      aria-label={label}
      className={s.root()}>
      {rows.map((row) => (
        <li
          key={row.id}
          className={s.row()}>
          {/* Blocks, since the words hold the reason's paragraph. */}
          <div className={act.frame({ class: FRAME_IN_BOX_CLASSES })}>
            <div className={act.words({ class: "gap-1" })}>
              <PartyHead
                name={row.name}
                {...(row.plaque === undefined ? {} : { plaque: row.plaque })}
                chips={[row.chip]}
              />
              <span className={s.line()}>{textOf(row.line)}</span>
              {row.reason !== undefined && <p className={s.reason()}>{textOf(row.reason)}</p>}
            </div>
            {row.acts !== undefined && <div className={act.acts()}>{row.acts}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}
