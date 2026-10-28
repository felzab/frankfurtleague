import type { ReactNode } from "react";

/**
 * Two fields that form one value, such as a street with its number or a postcode with its town: on desktop
 * they share a row, the long field taking the room the short one leaves at its width class; on a phone each
 * stands alone in its row, as every field there does. `short` names which of the two is the short one, since
 * the address writes the number after its street but the postcode before its town.
 */
export function FieldPair({ short, children }: { short: "first" | "second"; children: [ReactNode, ReactNode] }) {
  const [first, second] = children;
  // The short field keeps its class's width: its root fills its wrapper, which is as wide as the field.
  const keeps = "lg:shrink-0";
  const grows = "min-w-0 lg:flex-1";
  return (
    <div className="grid w-full gap-4 lg:flex lg:items-start lg:gap-3">
      <div className={short === "first" ? keeps : grows}>{first}</div>
      <div className={short === "second" ? keeps : grows}>{second}</div>
    </div>
  );
}
