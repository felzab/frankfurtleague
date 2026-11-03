import { columnHead } from "./cardStyles";

import type { Copy } from "@/core/copy";

/**
 * The head of one group inside a card, such as a line-up's „Startelf“ over its table: set as the table's column
 * heads are, so the card's own head stays the one band it carries. `rows` lines it up with a card's 16-px rows,
 * such as the matches the season card lists; a table's 12-px cells are its default.
 */
export function GroupHead({ text, inset }: { text: Copy; inset?: "cells" | "rows" }) {
  const slots = columnHead({ inset });
  return <h3 className={slots.text({ class: `flex items-center ${slots.rule()}` })}>{text}</h3>;
}
