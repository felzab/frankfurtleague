import { smallCaps } from "./cardStyles";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * A group of a box's fields under its name, set as the kit's subhead in small capitals, such as a season's points over
 * the win, the draw and the loss: 8 px more above it than between two fields, unless it opens the box, and 8 px under
 * its name. A fieldset and its legend, the platform's own group with a name, which a screen reader says before each
 * field's label.
 */
export const subgroup = tv({
  slots: {
    root: "grid w-full min-w-0 not-first:mt-2",
    name: smallCaps({ class: "mb-2" }),
  },
});

/**
 * Short fields holding values of one kind on one row, such as a win's, a draw's and a loss's points, a no-show's two
 * goals or a season's two counts: each takes the same room whatever its label, so the fields stand at one step and a
 * longer label never pushes its neighbour along. From `lg` an equal-column grid as wide as its widest column needs,
 * the grid's own way of sizing `1fr` columns to their content; on a phone the row's own wrap, each column growing from
 * nothing to an equal share of the row and never narrower than its label and its field, so a row too narrow for them
 * all drops a column under the others rather than squeezing it, and each field fills its column as a pair's do. A
 * column's message line runs on under its neighbour on desktop while the neighbour's own line stands empty, as a short
 * pair's does. `label` names the group over its fields as a subgroup (`subgroup`).
 */
export function FieldColumns({ label, children }: { label?: Copy; children: readonly [ReactNode, ReactNode, ...ReactNode[]] }) {
  const row = (
    <div
      data-pair
      className="flex w-full flex-wrap items-start gap-x-3 gap-y-2 lg:grid lg:w-fit lg:auto-cols-fr lg:grid-flow-col">
      {children.map((child, index) => (
        <div
          // The fields are fixed in number and order, so their place is their identity.
          key={index}
          className="min-w-max flex-1 empty:hidden lg:[&_[data-kit-message]]:overflow-visible lg:[&:has(+*_[data-kit-message]:not(:empty))_[data-kit-message]]:overflow-hidden">
          {child}
        </div>
      ))}
    </div>
  );
  if (label === undefined) return row;
  const slots = subgroup();
  return (
    <fieldset className={slots.root()}>
      <legend className={slots.name()}>{label}</legend>
      {row}
    </fieldset>
  );
}
