"use client";

import { useId } from "react";

import { ERGEBNIS_SEPARATOR } from "@/core/format";

import { fieldLabel, messageLine } from "./fieldStyles";
import { TextField } from "./TextField";

import type { Copy, Words } from "@/core/copy";

/**
 * A score as one value in one row at every width (D279, D342): a two-digit field, the colon between equal gaps, a
 * two-digit field, each field named by its side's club over it, under the group's own label, „Tore“ or
 * „Elfmeterschießen“. The result's goals and a shoot-out's alike.
 *
 * A group, so a screen reader names the pair with each field. Each field keeps its own message line for its
 * value's error; what the pair as a whole sets off, such as level knockout goals leaving the bracket waiting, stands
 * in the group's one line under both fields, as wide as the column, since a sentence under a two-digit field is
 * cut at its width.
 */
export function ScorePair({
  label,
  sides,
  names,
  values,
  onChange,
  consequence,
  isRequired = false,
  isDisabled = false,
}: {
  label: Copy;
  /** The two clubs, home first, whose names label their fields. */
  sides: readonly [Words, Words];
  /** The two fields' names, as the form posts them. */
  names: readonly [string, string];
  values: readonly [string, string];
  onChange: (side: 0 | 1, value: string) => void;
  /** What the pair's present value sets off beyond it, in the warn colour of a field's consequence. */
  consequence?: Copy;
  isRequired?: boolean;
  isDisabled?: boolean;
}) {
  const labelId = useId();
  const lineId = useId();
  const field = (side: 0 | 1) => (
    <TextField
      label={sides[side]}
      name={names[side]}
      width="C2"
      kind="digits"
      isRequired={isRequired}
      isDisabled={isDisabled}
      value={values[side]}
      onChange={(value) => onChange(side, value)}
    />
  );
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={consequence === undefined ? undefined : lineId}
      className="grid w-full gap-1">
      <span
        id={labelId}
        className={fieldLabel()}>
        {label}
      </span>
      {/* Each side takes half the row the colon leaves, so a club's name over its field has room to stand. */}
      <div className="flex items-end gap-3">
        {field(0)}
        {/* On the fields' own line: a box as tall as a control over a place as tall as their message line, 4 px
            apart as a field's frame and line are, so a club's name wrapping over its field grows the row upward and
            moves nothing beside it. */}
        <span
          aria-hidden
          className="grid shrink-0 gap-1">
          <span className="flex h-8 items-center font-numeric text-base text-fg-muted pointer-coarse:h-10">{ERGEBNIS_SEPARATOR}</span>
          <span className={messageLine()} />
        </span>
        {field(1)}
      </div>
      {/* Always there, so a consequence appearing moves nothing. */}
      <p
        id={lineId}
        className={messageLine({ tone: "consequence" })}>
        {consequence}
      </p>
    </div>
  );
}
