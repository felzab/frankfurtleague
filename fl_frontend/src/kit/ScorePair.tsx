"use client";

import { useId } from "react";

import { ERGEBNIS_SEPARATOR } from "@/core/format";

import { cardSurface } from "./cardStyles";
import { messageLine } from "./fieldStyles";
import { TeamPlaque } from "./TeamPlaque";
import { TextField } from "./TextField";
import { tv } from "./tv";

import type { Copy, Words } from "@/core/copy";
import type { Plaque } from "./TeamPlaque";

/** One side of the score: its club's name, which labels its field, and its plaque where the club's Kürzel is known. */
export type ScoreSide = { name: Words; plaque: Plaque | null };

/** What the figures typed so far decide, in the tone a match's outcome takes elsewhere: a win's, or a draw's. */
export type ScoreOutcome = { text: Copy; tone: "win" | "draw" };

const scorePair = tv({
  slots: {
    // A box of its own inside the section's, so the score reads as the one value it is, apart from the switch above.
    panel: cardSurface({ class: "grid w-full gap-2 p-4" }),
    // Each side takes half the row the colon leaves, so a club's name over its field has room to stand.
    row: "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-3",
    // The plaque over the field, which stands centred under it.
    side: "grid justify-items-center gap-2",
    line: "text-center text-sm font-medium",
  },
  variants: {
    // The hues the Timeline marks a result in, a decided match `success` and a draw `warn`; a consequence takes a
    // field's consequence hue, which is `warn` too.
    tone: {
      success: { line: "text-success" },
      warn: { line: "text-warn" },
      none: {},
    },
  },
});

/** Each outcome's hue. */
const HUE = { win: "success", draw: "warn" } as const;

/**
 * A score as one value in one row at every width (D279, D342), drawn as the match head draws a match (D358 kopf B):
 * each side's plaque over its club's name over its two-digit field, the colon between them on the fields' line, the
 * whole centred in a box of its own. The result's goals and a shoot-out's alike. `label`, „Tore“ or
 * „Elfmeterschießen“, names the group for a screen reader; the box and the clubs say it on the screen.
 *
 * Each field keeps its own message line for its value's error; the pair's one line under both fields, centred as
 * they are, says what the pair as a whole sets off, such as level knockout goals leaving the bracket waiting, else
 * what the figures decide, „… gewinnt 3:1“ or „Unentschieden 2:2“, in its outcome's tone.
 */
export function ScorePair({
  label,
  sides,
  names,
  values,
  onChange,
  consequence,
  outcome,
  isRequired = false,
}: {
  label: Copy;
  /** The two clubs, home first. */
  sides: readonly [ScoreSide, ScoreSide];
  /** The two fields' names, as the form posts them. */
  names: readonly [string, string];
  values: readonly [string, string];
  onChange: (side: 0 | 1, value: string) => void;
  /** What the pair's present value sets off beyond it, in the warn colour of a field's consequence. */
  consequence?: Copy;
  /** What the figures decide, once both are typed. */
  outcome?: ScoreOutcome | null;
  isRequired?: boolean;
}) {
  const lineId = useId();
  const said = consequence ?? outcome?.text;
  const tone = outcome === undefined || outcome === null ? "none" : HUE[outcome.tone];
  const slots = scorePair({ tone: consequence === undefined ? tone : "warn" });
  // A plaque on both sides or on neither, so the two fields stay on one line.
  const plaques = sides[0].plaque !== null && sides[1].plaque !== null;
  const field = (side: 0 | 1) => (
    <div className={slots.side()}>
      {plaques && sides[side].plaque !== null && <TeamPlaque plaque={sides[side].plaque} />}
      <TextField
        label={sides[side].name}
        name={names[side]}
        width="C2"
        kind="digits"
        align="center"
        isRequired={isRequired}
        value={values[side]}
        onChange={(value) => onChange(side, value)}
      />
    </div>
  );
  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={said === undefined ? undefined : lineId}
      className={slots.panel()}>
      <div className={slots.row()}>
        {field(0)}
        {/* On the fields' own line: a box as tall as a control over a place as tall as their message line, 4 px
            apart as a field's frame and line are, so a club's name over its field moves nothing beside it. */}
        <span
          aria-hidden
          className="grid shrink-0 gap-1">
          <span className="flex h-8 items-center font-numeric text-base text-fg-muted pointer-coarse:h-10">{ERGEBNIS_SEPARATOR}</span>
          <span className={messageLine()} />
        </span>
        {field(1)}
      </div>
      {/* Always there, so a line appearing moves nothing. */}
      <p
        id={lineId}
        className={slots.line({ class: "min-h-5" })}>
        {said}
      </p>
    </div>
  );
}
