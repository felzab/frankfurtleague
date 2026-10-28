import type { ReactNode } from "react";

/**
 * Two fields that belong in one row, such as a street with its number, a postcode with its town or a day with
 * its time: `short` names the field that keeps its width class, the other taking the room it leaves, or both
 * where each keeps its own. A pair forming one value shares its row on a phone too; any other pair stands one
 * field per row there, as every field does. The address writes the number after its street but the postcode
 * before its town, which is why `short` names a side.
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
  // fields may each shrink instead, so where the row is narrower than both the second drops under the first.
  // A field not shown, such as a price revealed only once its venue is chosen, leaves no wrapper and no gap.
  const keeps = short === "both" ? "min-w-0 empty:hidden" : paired ? "shrink-0 empty:hidden" : "empty:hidden lg:shrink-0";
  const grows = paired ? "min-w-0 flex-1 empty:hidden" : "min-w-0 empty:hidden lg:flex-1";
  return (
    // 8 px between the rows where the two stand one under the other, as the fields of an editor's box are.
    <div className={paired ? "flex w-full flex-wrap items-start gap-x-3 gap-y-2" : "grid w-full gap-2 lg:flex lg:items-start lg:gap-3"}>
      <div className={short === "second" ? grows : keeps}>{first}</div>
      <div className={short === "first" ? grows : keeps}>{second}</div>
    </div>
  );
}
