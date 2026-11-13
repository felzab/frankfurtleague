import { columnHead } from "./cardStyles";

import type { Copy } from "@/core/copy";

/**
 * The head of one group inside a card, such as a line-up's „Startelf“ over its table: set as the table's column
 * heads are, so the card's own head stays the one band it carries. `rows` lines it up with a card's 16-px rows,
 * such as the matches the season card lists; a table's 12-px cells are its default. Its rung is the one under the
 * heading it stands beneath: 3 under a card's or a section's title, 2 where it stands directly under the page's.
 */
export function GroupHead({ text, inset, level = 3 }: { text: Copy; inset?: "cells" | "rows"; level?: 2 | 3 }) {
  const slots = columnHead({ inset });
  const Heading = level === 2 ? "h2" : "h3";
  return <Heading className={slots.text({ class: `flex items-center ${slots.rule()}` })}>{text}</Heading>;
}
