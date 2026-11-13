"use client";

import { useId } from "react";

import { textOf } from "@/core/copy";
import { formatNumber } from "@/core/format";

import { smallCaps } from "./cardStyles";
import { LockMark, RequiredMark, useFieldLock } from "./FieldParts";
import { fieldFrame } from "./fieldStyles";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { TeamPlaque } from "./TeamPlaque";
import { TextField } from "./TextField";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Plaque } from "./TeamPlaque";

/** One side of the score: its club's name, which names its row, and its plaque where the club's Kürzel is known. */
export type ScoreSide = { name: Words; plaque: Plaque | null };

/** What the figures typed so far decide, in the tone a match's outcome takes elsewhere: a win's, or a draw's. */
export type ScoreOutcome = { text: Copy; tone: "win" | "draw" };

/** One column of figures, a field per side, home first. */
type ScoreColumn = {
  /** Names the column's fields, and heads a shoot-out's column unless `head` does. */
  label: Copy;
  /** A shoot-out's column's head, where the label is too long to stand over a two-digit field. */
  head?: Copy;
  /** The two fields' names, as the form posts them. */
  names: readonly [string, string];
  values: readonly [string, string];
  onChange: (side: 0 | 1, value: string) => void;
  isRequired: boolean;
  /** Held fixed by its record: both fields disabled, a headed column's head marked with the lock (`useFieldLock`). */
  isLocked?: boolean;
};

/**
 * The goals as figures nobody types, home first, counted from what the form lists elsewhere, as a match report counts
 * its goals rows: shown where the column's fields would stand, beside a shoot-out's fields.
 */
type CountedColumn = { label: Copy; head?: never; counted: readonly [number, number] };

/** A score field's box, a short field of two characters at its inset, for what stands in a field's place. */
const SCORE_FIELD_CLASSES = `${fieldFrame.variants.width.short} ${fieldFrame.variants.holds[2]} ${fieldFrame.variants.inset.full}`;

const scoreRows = tv({
  slots: {
    // The section's own spacing above it, as every field of the box has.
    root: "grid w-full gap-x-3",
    // A line of its own over the column's start, from the head to the last row's fields, rather than a border on each
    // cell: it ends with the fields, in the last row's own 4 px under them.
    rule: "col-start-3 row-span-3 row-start-1 mb-1 w-px bg-border",
    // Each row shares the block's columns, so the heads stand over their fields whatever a name's length. Its fields'
    // roots dissolve into it, so a field's frame takes the first line and its message line the second.
    row: "col-span-full grid grid-cols-subgrid gap-y-1 py-1",
    head: smallCaps(),
    side: "col-start-1 row-start-1 flex h-8 min-w-0 items-center gap-2 pointer-coarse:h-10",
    name: "truncate text-sm font-medium",
    field: "contents [&_[data-kit-message]]:row-start-2 [&_[data-kit-message]]:text-end [&_input]:row-start-1 [&>*]:contents",
    // A counted figure in a field's place and at its width and inset, so it stands where a typed one would, in the bold
    // a score takes.
    figure: `col-start-2 row-start-1 flex items-center font-numeric text-base font-bold ${SCORE_FIELD_CLASSES}`,
    line: "col-span-full row-start-4 text-sm font-medium",
  },
  variants: {
    // The hues the Timeline marks a result in, a decided match `success` and a draw `warn`; a consequence takes a
    // field's consequence hue, which is `warn` too.
    tone: {
      success: { line: "text-success" },
      warn: { line: "text-warn" },
      none: {},
    },
    columns: {
      1: { root: "grid-cols-[minmax(0,1fr)_auto]" },
      2: { root: "grid-cols-[minmax(0,1fr)_auto_auto]" },
    },
    place: {
      head: { row: "row-start-1" },
      0: { row: "row-start-2" },
      1: { row: "row-start-3" },
    },
    // Each message line ends under its own field and takes the track before it, since a short field is narrower than
    // „Pflichtfeld“; the two lines of one row overlap only where both hold a message past the rule.
    column: {
      tore: {
        field: "[&_[data-kit-message]]:col-span-2 [&_[data-kit-message]]:col-start-1 [&_input]:col-start-2",
      },
      shootOut: {
        head: "col-start-3 ps-3",
        field: "[&_[data-kit-message]]:col-span-2 [&_[data-kit-message]]:col-start-2 [&_input]:col-start-3 [&_input]:ms-3",
      },
    },
  },
});

const HUE = { win: "success", draw: "warn" } as const;

const SIDES = [0, 1] as const;

/**
 * A match's score as rows: a side per row, its plaque and its name at the far left and its figures at the far right,
 * as `FieldRows` sets a label and its input, straight under the section's title with no head of their own, the goals'
 * fields named by their hidden label. The shoot-out's column opens at the row's end on a level knockout score under its
 * head, moving the goals' column inward, the hairline parting the two from the head to the last row, so a shoot-out's
 * figure is never read as a goal.
 *
 * Each field keeps its own message line for its value's error. The one line under the rows says what the score as a
 * whole sets off, such as level knockout goals leaving the bracket waiting, else what the figures decide, „… gewinnt
 * 3:1“ or „Unentschieden 2:2“, in its outcome's tone. A row is a group named by its club, so a field is heard as its
 * column on its club's row.
 *
 * Goals counted elsewhere on the form stand as figures in their fields' place (`counted`), heard as the column's label
 * and the figure, beside a shoot-out's fields, which stay typed.
 */
export function ScoreRows({
  sides,
  tore,
  shootOut,
  consequence,
  outcome,
}: {
  /** The two clubs, home first. */
  sides: readonly [ScoreSide, ScoreSide];
  tore: ScoreColumn | CountedColumn;
  /** The shoot-out's column, on a level knockout score alone. */
  shootOut: ScoreColumn | null;
  /** What the score's present value sets off beyond it, in the warn colour of a field's consequence. */
  consequence?: Copy;
  /** What the figures decide, once the figures it reads are typed. */
  outcome: ScoreOutcome | null;
}) {
  const id = useId();
  const said = consequence ?? outcome?.text;
  const tone = consequence !== undefined ? "warn" : outcome === null ? "none" : HUE[outcome.tone];
  const slots = scoreRows({ tone, columns: shootOut === null ? 1 : 2 });
  const lineId = `${id}-line`;
  // A plaque on both sides or on neither, so the two names start at one edge.
  const plaques = sides[0].plaque !== null && sides[1].plaque !== null;
  // Only the shoot-out's column has a head to mark: the goals' fields are named by their hidden label alone.
  const shootOutLock = useFieldLock(false, shootOut?.isLocked ?? false);
  const columnHead = (column: "shootOut", shown: ScoreColumn) => (
    <span className={slots.head({ column })}>
      {shown.head ?? shown.label}
      {shootOutLock.isMarked ? <LockMark /> : <RequiredMark isRequired={shown.isRequired} />}
    </span>
  );
  const counted = (side: 0 | 1, { label, counted: figures }: CountedColumn) => (
    <span
      key="counted"
      className={slots.figure()}>
      {/* Heard as the column it stands in, as a typed field's hidden label is: each a flex item, so the two are two words. */}
      <span className="sr-only">{label}</span>
      <span>{formatNumber(figures[side])}</span>
    </span>
  );
  const field = (side: 0 | 1, column: "tore" | "shootOut", { label, names, values, onChange, isRequired, isLocked }: ScoreColumn) => (
    <div
      // Keyed by what it posts, so a column opening beside it leaves a field and its focus where they are.
      key={names[side]}
      className={slots.field({ column })}>
      <TextField
        label={label}
        labelHidden
        name={names[side]}
        holds={2}
        kind="digits"
        isRequired={isRequired}
        isLocked={isLocked}
        value={values[side]}
        onChange={(value) => onChange(side, value)}
      />
    </div>
  );
  return (
    <div className={slots.root()}>
      {shootOut !== null && (
        <span
          aria-hidden
          className={slots.rule()}
        />
      )}
      {/* The goals' column stands unheaded, its fields named by their hidden label; a shoot-out's opens with its head,
          so its figure is never read as a goal. */}
      {shootOut !== null && <div className={slots.row({ place: "head" })}>{columnHead("shootOut", shootOut)}</div>}
      {SIDES.map((side) => (
        <div
          key={side}
          role="group"
          aria-labelledby={`${id}-${side}`}
          aria-describedby={said === undefined ? undefined : lineId}
          className={slots.row({ place: side })}>
          <span className={slots.side()}>
            {plaques && sides[side].plaque !== null && <TeamPlaque plaque={sides[side].plaque} />}
            <span
              id={`${id}-${side}`}
              className={slots.name()}>
              {textOf(sides[side].name)}
            </span>
          </span>
          {"counted" in tore ? counted(side, tore) : field(side, "tore", tore)}
          {shootOut !== null && field(side, "shootOut", shootOut)}
        </div>
      ))}
      {said !== undefined && (
        <p
          id={lineId}
          className={slots.line()}>
          {said}
        </p>
      )}
    </div>
  );
}

/** The score's rows while the match is read: its goals' column and two sides, the shoot-out's column being the rare one. */
export function ScoreRowsPlaceholder() {
  const slots = scoreRows({ columns: 1 });
  return (
    <div className={slots.root()}>
      {SIDES.map((side) => (
        <div
          key={side}
          className={slots.row({ place: side })}>
          <span className={slots.side()}>
            <span className={placeholderBar("h-6 w-10")} />
            <PlaceholderLine
              textClass={slots.name()}
              widthClass="w-24"
            />
          </span>
          <span className={placeholderBar(`col-start-2 row-start-1 rounded-lg text-sm pointer-coarse:text-base ${SCORE_FIELD_CLASSES}`)} />
        </div>
      ))}
    </div>
  );
}
