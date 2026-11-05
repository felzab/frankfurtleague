import type { ReactNode } from "react";

/**
 * Cards side by side, as the administrator's Übersicht sets its four kinds of open work: one column on a phone,
 * two from `lg`, 24 px apart as a page's sections are. Two cards sharing a row stand as tall as each other, each
 * packing its rows at its top (`cardStyles.ts :: card`), the spare height left empty under them.
 */
export function CardGrid({ children }: { /** The kit's `Card`s, in their order of reading. */ children: ReactNode }) {
  return <div className="grid gap-6 lg:grid-cols-2">{children}</div>;
}
