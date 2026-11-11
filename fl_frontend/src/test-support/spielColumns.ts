import { expect } from "vitest";

/** What holds a list's match columns (`fl_frontend/src/kit/SpielRow.tsx :: SPIEL_COLUMNS_CLASSES`), the timeline's beside its points. */
const HOLDS = ["grid-cols-(--spiel-columns)", "max-lg:grid-cols-(--spiel-columns)", "grid-cols-[auto_var(--spiel-columns)]"];

/** What hands them on, a pair's box below `lg` among them. */
const HANDS_ON = ["grid-cols-subgrid", "max-lg:grid-cols-subgrid"];

/**
 * The one element holding the columns of every one-line match row in `within`, which jsdom lays out nowhere to measure.
 * What the rows' alignment rests on: from each row up to the one holder, every part hands the columns on as a subgrid
 * and none is a container, since a container is no subgrid and drops every column in a browser; the holder is the
 * container whose width picks the rows' form.
 */
export function spielColumnsHolder(within: Element) {
  const lines = [...within.querySelectorAll("*")].filter((part) => part.classList.contains("@max-2xl:hidden"));
  expect(lines.length).toBeGreaterThan(1);
  const holders = lines.map((line) => {
    let part: Element | null = line;
    while (part !== null && !HOLDS.some((name) => part?.classList.contains(name) === true)) {
      expect(HANDS_ON.some((name) => part?.classList.contains(name) === true)).toBe(true);
      expect(part.classList.contains("@container")).toBe(false);
      part = part.parentElement;
    }
    return part;
  });
  expect(new Set(holders).size).toBe(1);
  expect(holders[0]?.classList.contains("@container")).toBe(true);
  return holders[0];
}
