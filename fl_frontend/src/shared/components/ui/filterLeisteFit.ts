/**
 * SHARED · how many filter triggers fit in one row
 *
 * The arithmetic behind `FilterLeiste`'s overflow, kept apart from it so the decision is tested rather
 * than clicked. Widths arrive already measured; nothing here touches the DOM.
 *
 * Invariants:
 * - The overflowed set is always a SUFFIX of the candidates, so the row keeps its display order.
 * - More inline is always preferred to fewer, and naming the overflowed dimensions to counting them.
 * - Nothing this returns can change a width it was given — that is what keeps the measurement from
 *   oscillating between two answers.
 */

/** One candidate's width, both label forms, and the space they are competing for. All in CSS pixels. */
export type FitInput = {
  /** Row width less whatever the always-inline dimensions already take, and their trailing gap. */
  available: number;
  /** Each overflow candidate's own width, in the order the row would draw them. */
  candidates: readonly number[];
  /** Index `k - 1` is the overflow control showing `k` dimensions BY NAME. */
  namesWidths: readonly number[];
  /** Index `k - 1` is the same control showing `k` as a count. */
  countWidths: readonly number[];
  gap: number;
};

/** How many candidates the row takes, and whether the overflow control can afford to name the rest. */
export type Fit = { pulled: number; namesFit: boolean };

function spanOf(widths: readonly number[], count: number, gap: number): number {
  return widths.slice(0, count).reduce((sum, width) => sum + width + gap, 0);
}

/**
 * The most dimensions the row can show, and the widest overflow label that still fits beside them.
 *
 * Tried from the most inline downwards, so the first answer that fits is also the best one. When every
 * candidate fits there is no overflow control at all and its width never enters the sum — which is why
 * a surface whose dimensions all fit shows no control rather than an empty one.
 *
 * The last resort is everything overflowed under a counted label: at that width the row scrolls
 * sideways, and a control that names nothing is still better than one that is not reachable.
 */
export function fitOverflow({ available, candidates, namesWidths, countWidths, gap }: FitInput): Fit {
  if (candidates.length === 0) return { pulled: 0, namesFit: true };

  if (spanOf(candidates, candidates.length, gap) <= available) return { pulled: candidates.length, namesFit: true };

  for (let pulled = candidates.length - 1; pulled >= 0; pulled--) {
    const room = available - spanOf(candidates, pulled, gap) - gap;
    const overflowed = candidates.length - pulled;

    if ((namesWidths[overflowed - 1] ?? Infinity) <= room) return { pulled, namesFit: true };
    if ((countWidths[overflowed - 1] ?? Infinity) <= room) return { pulled, namesFit: false };
  }

  return { pulled: 0, namesFit: false };
}
