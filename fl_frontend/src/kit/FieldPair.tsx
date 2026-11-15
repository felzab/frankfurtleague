import type { ReactNode } from "react";

/**
 * Two fields forming one value, sharing one row at every screen width: a day with its time, a street with its number,
 * a postcode with its town. A side holding a short field keeps its width (its frame says so, `data-kit-short`) and a
 * side holding a standard one takes the room it leaves, so a street and its number together end where the standard
 * fields over and under them end, and a day and its time stand at their own two widths. A short side's message wraps
 * at its field's width, as every field's does. Two fields holding two values stand one under the other, as every field
 * does, and values of one kind, or a span's two ends, stand as `FieldRows`.
 */
export function FieldPair({ children }: { children: [ReactNode, ReactNode] }) {
  const [first, second] = children;
  const SIDE_CLASSES = "min-w-0 flex-1 has-[[data-kit-short]]:flex-none";
  return (
    <div className="flex w-full max-w-field items-start gap-x-3">
      <div className={SIDE_CLASSES}>{first}</div>
      <div className={SIDE_CLASSES}>{second}</div>
    </div>
  );
}
