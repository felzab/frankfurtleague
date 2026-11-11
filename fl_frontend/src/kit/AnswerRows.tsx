import { textOf } from "@/core/copy";

import { nameWithChips, stacked } from "./cardStyles";
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
    line: "text-xs text-fg-muted",
    reason: "break-words whitespace-pre-line",
  },
});

// A party's plaque before its line of name and chips, centred on the lines they take.
const PARTY_CLASSES = "flex min-w-0 items-center gap-2";

/**
 * A party's name with its chips, here and on a seat's row (`SeatRows`): the chips directly after the name on its line,
 * as every row holds them (`cardStyles.ts :: nameWithChips`), after its plaque. A name too long for its line is cut with
 * „…“. `id` names the name, for what its row's acts are described by.
 */
export function PartyHead({
  name,
  plaque,
  chips,
  muted = false,
  id,
}: {
  name: Words;
  plaque?: Plaque;
  chips: ReadonlyArray<ChipProps>;
  /** A place nobody holds: its name muted. */
  muted?: boolean;
  id?: string;
}) {
  const s = nameWithChips({ card: true, led: true });
  return (
    <span className={PARTY_CLASSES}>
      {plaque !== undefined && <TeamPlaque plaque={plaque} />}
      <span className={s.line()}>
        <span className={s.head()}>
          <CutText
            id={id}
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
 * A party's name and chips while they are read: a bar each, the plaque's before the name's where the rows carry one,
 * in the line the rows draw theirs in, so the chips' bar stands where the chips will.
 */
export function PartyHeadPlaceholder({ plaque = false }: { plaque?: boolean }) {
  const s = nameWithChips({ card: true, led: true });
  return (
    <span className={PARTY_CLASSES}>
      {plaque && <span className={placeholderBar("h-6 w-10")} />}
      <span className={s.line()}>
        <PlaceholderLine
          textClass={s.name()}
          widthClass="w-24"
        />
        <span className={s.chips()}>
          <span className={placeholderBar("h-5 w-16")} />
        </span>
      </span>
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
  const s = answerRows();
  return (
    <div className={s.root()}>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={s.row()}>
          <PartyHeadPlaceholder plaque />
          <PlaceholderLine
            textClass={s.line()}
            widthClass="w-1/3"
          />
        </div>
      ))}
    </div>
  );
}
