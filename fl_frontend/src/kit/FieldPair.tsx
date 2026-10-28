import type { ReactNode } from "react";

/**
 * Two fields that form one value, such as a street with its number or a postcode with its town: on desktop
 * they share a row, the first taking the room the second leaves at its width class; on a phone each stands
 * alone in its row, as every field there does.
 */
export function FieldPair({ children }: { children: [ReactNode, ReactNode] }) {
  const [first, second] = children;
  return (
    <div className="grid w-full gap-4 lg:flex lg:items-start lg:gap-3">
      <div className="min-w-0 lg:flex-1">{first}</div>
      {/* The short field keeps its class's width: its root fills this wrapper, which is as wide as the field. */}
      <div className="lg:shrink-0">{second}</div>
    </div>
  );
}
