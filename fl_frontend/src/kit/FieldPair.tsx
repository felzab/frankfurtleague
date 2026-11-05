import { smallCaps } from "./cardStyles";
import { columnCap, fieldFrame, fieldLabel, fieldRoot, messageLine } from "./fieldStyles";
import { placeholderBar, PlaceholderLine } from "./Skeleton";
import { tv } from "./tv";

import type { Copy } from "@/core/copy";
import type { ReactNode } from "react";

/**
 * Where a side's message line may run past its field, on desktop, where a short field such as a score or a count
 * is narrower than „Zwischen 1 und 16“: the line is cut at the field's width otherwise, its words adding nothing to
 * the width a field is laid out at (`fieldStyles.ts :: messageLine`). The first side's line runs on under the second
 * side while the second side's own line stands empty, so two messages never overlap; the second side of two short
 * fields runs on into the row the pair leaves after it. A side at the row's end, a long field's partner, keeps its
 * cut. On a phone each side of a pair is as wide as its share of the row, which holds its message.
 */
const reach = tv({
  variants: {
    side: {
      first:
        "lg:[&_[data-kit-message]]:overflow-visible lg:group-has-[[data-pair-side=second]_[data-kit-message]:not(:empty)]/pair:[&_[data-kit-message]]:overflow-hidden",
      second: "lg:[&_[data-kit-message]]:overflow-visible",
      none: "",
    },
  },
});

/**
 * A field while the record filling it is read: its label's line, its frame at its width class's size, and the
 * message line under it, in the field's own column, so a box of placeholders stands as tall as its fields will. A
 * field whose line appears with its error alone, the sign-in's address, takes `line={false}`.
 */
export function FieldPlaceholder({ width, line = true }: { width: "W3" | "C10" | "C5" | "C2" | "column"; line?: boolean }) {
  return (
    <div className={fieldRoot()}>
      <PlaceholderLine
        text={fieldLabel()}
        width="w-24"
      />
      <span className={placeholderBar(`rounded-lg ${fieldFrame.variants.width[width]}`)} />
      {line && <span className={messageLine()} />}
    </div>
  );
}

/**
 * Two fields of one row while they are read, as `FieldPair` sets a long field beside a short one: the pair's own
 * row, a phone's included.
 */
export function FieldPairPlaceholder() {
  return (
    <FieldPair
      short="second"
      phone="pair">
      <FieldPlaceholder width="W3" />
      <FieldPlaceholder width="C10" />
    </FieldPair>
  );
}

/**
 * Two fields that belong in one row, such as a street with its number, a postcode with its town or a day with
 * its time: `short` names the field that keeps its width class, the other growing into the room it leaves as far as
 * a long field's cap, or both where each keeps its own. A pair forming one value shares its row on a phone too, and
 * fills it there: the long side takes the room the short one leaves, and two short sides share it, each growing from
 * its own width. Any other pair stands one field per row on a phone, as every field does. The address writes the
 * number after its street but the postcode before its town, which is why `short` names a side. Two fields holding
 * values of one kind stand as `FieldColumns` instead.
 */
export function FieldPair({
  short,
  phone,
  children,
}: {
  short: "first" | "second" | "both";
  /** On a phone: side by side, as a pair forming one value stays, or each field in its own row. */
  phone: "pair" | "stack";
  children: [ReactNode, ReactNode];
}) {
  const [first, second] = children;
  const paired = phone === "pair";
  // A short field keeps its class's width: its root fills its wrapper, which is as wide as the field. Two short
  // fields may each shrink instead, and on a phone each grows from its width to fill the row; the row breaks
  // on those starting widths, so the second drops under the first only where the row is narrower than both.
  // A field not shown, such as a price revealed only once its venue is chosen, leaves no wrapper and no gap.
  const keeps = short === "both" ? "min-w-0 empty:hidden max-lg:flex-auto" : paired ? "shrink-0 empty:hidden" : "empty:hidden lg:shrink-0";
  // The long side grows as far as its field does, the form's cap from `lg`, so its short partner stands beside it
  // rather than at the row's far end.
  const grows = columnCap({ class: paired ? "min-w-0 flex-1 empty:hidden" : "min-w-0 empty:hidden lg:flex-1" });
  return (
    // 8 px between the rows where the two stand one under the other, as the fields of an editor's box are.
    <div
      data-pair={paired || undefined}
      className={`group/pair ${paired ? "flex w-full flex-wrap items-start gap-x-3 gap-y-2" : "grid w-full gap-2 lg:flex lg:items-start lg:gap-3"}`}>
      <div className={reach({ side: "first", class: short === "second" ? grows : keeps })}>{first}</div>
      <div
        data-pair-side="second"
        className={reach({ side: short === "both" ? "second" : "none", class: short === "first" ? grows : keeps })}>
        {second}
      </div>
    </div>
  );
}

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
