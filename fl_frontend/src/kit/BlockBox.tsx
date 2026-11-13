import type { ReactNode } from "react";

/**
 * The box a block's container queries read, around the block, since a query reads an ancestor; `w-full`, since a
 * container's width counts none of its content, so a parent starting its children would shrink it to nothing.
 */
export function BlockBox({ children }: { children: ReactNode }) {
  return <div className="@container w-full">{children}</div>;
}
