/**
 * SHARED · which facet cells share a line in the filter panel
 *
 * The arithmetic behind `FilterPanel`'s wrap, kept apart from it so the decision is tested rather than
 * clicked. Widths arrive already measured; nothing here touches the DOM.
 *
 * Invariants:
 * - A line is always a contiguous run, so the panel keeps the facet order it was given.
 * - The input is each cell's NATURAL width, which does not depend on the wrap — so no arrangement this
 *   returns can change the numbers that produced it, and re-running it cannot oscillate.
 * - `packLines` reproduces what a wrapping flex row does on its own; `balanceLastLine` only ever
 *   returns that or one arrangement with the same cells in the same order and no lone last line.
 * - Where it cannot beat the flex row's own answer it returns exactly that, rather than trading one
 *   shape for another.
 */

/** A line, as the indices of the cells on it. */
export type Line = readonly number[];

/**
 * The lines a wrapping flex row would produce: take cells left to right while the next one still fits.
 *
 * `sizes` are hypothetical main sizes — a cell's own content width already clamped by its `min-w-44`
 * floor. A cell wider than the line gets a line of its own and overflows it, which is what flexbox does
 * and what `max-w-full` then reins in.
 */
export function packLines(sizes: readonly number[], width: number, gap: number): Line[] {
  const lines: number[][] = [];
  let current: number[] = [];
  let used = 0;

  for (const [index, size] of sizes.entries()) {
    const cost = current.length === 0 ? size : gap + size;
    if (current.length > 0 && used + cost > width) {
      lines.push(current);
      current = [index];
      used = size;
      continue;
    }
    current.push(index);
    used += cost;
  }

  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * The same lines, unless the last one holds a single cell and the final pair could share it instead.
 *
 * **A cell alone on a line is the one shape the panel cannot fill.** Every line with two or more cells
 * reaches the full width between them, so the only leftover a panel can carry is beside a lone cell —
 * and the cell cannot grow into it without becoming a band several times wider than any other in the
 * panel. Moving one cell down from the line above closes it: four facets that packed three and one
 * become two and two, both lines full.
 *
 * **Three refusals, and each leaves the packed answer untouched:** fewer than three cells, because
 * there is no line above to take one from; a final pair too wide to share a line, which is what a
 * narrow panel does to the two widest facets; and a head that would itself end on a lone cell, which
 * would move the gap rather than close it.
 */
export function balanceLastLine(sizes: readonly number[], width: number, gap: number): Line[] {
  const packed = packLines(sizes, width, gap);

  const last = packed.at(-1);
  if (packed.length < 2 || last === undefined || last.length !== 1) return packed;
  if (sizes.length < 3) return packed;

  const penultimate = sizes.at(-2);
  const final = sizes.at(-1);
  if (penultimate === undefined || final === undefined) return packed;
  if (penultimate + gap + final > width) return packed;

  const head = packLines(sizes.slice(0, -2), width, gap);
  const headLast = head.at(-1);
  if (headLast === undefined) return packed;
  if (head.length > 1 && headLast.length === 1) return packed;

  const tail = [sizes.length - 2, sizes.length - 1];
  return [...head, tail];
}
