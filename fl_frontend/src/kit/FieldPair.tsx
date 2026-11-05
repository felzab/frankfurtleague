import { columnCap, fieldLabel } from "./fieldStyles";
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
 * Two fields that belong in one row, such as a street with its number, a postcode with its town or a day with
 * its time: `short` names the field that keeps its width class, the other growing into the room it leaves as far as
 * a long field's cap, or both where each keeps its own. A pair forming one value shares its row on a phone too, and
 * fills it there: the long side takes the room the short one leaves, and two short sides share it, each growing from
 * its own width. Any other pair stands one field per row on a phone, as every field does. The address writes the
 * number after its street but the postcode before its town, which is why `short` names a side. A pair whose own
 * labels do not say what the value is, such as the two goals a no-show is scored with, takes `label`, naming the
 * value over both fields at a label's grade, as a group a screen reader names with each field.
 */
export function FieldPair({
  label,
  short,
  phone,
  children,
}: {
  label?: Copy;
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
  const row = (
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
  if (label === undefined) return row;
  // A fieldset and its legend: the platform's own group with a name, read before each field's label.
  return (
    <fieldset className="grid w-full min-w-0">
      <legend className={fieldLabel({ class: "mb-1" })}>{label}</legend>
      {row}
    </fieldset>
  );
}
