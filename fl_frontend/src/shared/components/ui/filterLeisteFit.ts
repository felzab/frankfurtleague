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
 * - `NARROW_ROW` is the one place a row width is called narrow, so the promotion the surface gives up
 *   and the label the overflow control gives up cannot disagree about where that starts.
 */

/** One candidate's width, both label forms, and the space they are competing for. All in CSS pixels. */
export type FitInput = {
  /** Row width less what the dimensions that are FILTERING already take, and their trailing gaps. */
  available: number;
  /** Each candidate's own width, in the order the row gives them up — the last one goes first. */
  candidates: readonly number[];
  /**
   * How many dimensions sit behind the control however much room there is — the ones past the cap.
   *
   * This is what makes the control's presence independent of the fit: with any of these there is a
   * control to pay for even when every candidate stays inline.
   */
  alwaysOverflowed: number;
  /** Index `k - 1` is the overflow control showing `k` dimensions BY NAME. */
  namesWidths: readonly number[];
  /** Index `k - 1` is the same control showing `k` as a count. */
  countWidths: readonly number[];
  gap: number;
};

/** How many candidates the row takes, and whether the overflow control can afford to name the rest. */
export type Fit = { pulled: number; namesFit: boolean };

/**
 * The row width at and above which the row is the wide case.
 *
 * Read off the ROW rather than the viewport, because the row is what has to hold the triggers and its
 * width is already measured here — one number then decides both things that depend on it, the last
 * promoted dimension stepping back into the overflow and the overflow control dropping to its icon.
 *
 * Tailwind's `sm` read in row pixels. A 375px phone leaves 343 after the page's own inset and the
 * narrowest tablet layout leaves 704, so no layout in the app sits near the boundary.
 */
export const NARROW_ROW = 640;

/** Whether a row of this width is the narrow case, so the comparison is written once. */
export function isNarrowRow(width: number): boolean {
  return width < NARROW_ROW;
}

function spanOf(widths: readonly number[], count: number, gap: number): number {
  return widths.slice(0, count).reduce((sum, width) => sum + width + gap, 0);
}

/**
 * The most dimensions the row can show, and the widest overflow label that still fits beside them.
 *
 * Tried from the most inline downwards, so the first answer that fits is also the best one. The search
 * reaches zero, which is what makes never overflowing an invariant rather than a hope: a row too narrow
 * for the dimensions its surface asked for gives them up one at a time until what is left fits beside
 * the control, and only what is FILTERING is beyond its reach.
 *
 * **No control at all is possible in exactly one case** — nothing forced behind one and every candidate
 * inline. Its width then never enters the sum, which is why a surface whose dimensions all fit shows no
 * control rather than an empty one.
 *
 * The last resort is everything overflowed under a counted label: at that width the row is down to the
 * dimensions that are filtering, and a control that names nothing is still better than none at all.
 */
export function fitOverflow({ available, candidates, alwaysOverflowed, namesWidths, countWidths, gap }: FitInput): Fit {
  if (alwaysOverflowed === 0 && (candidates.length === 0 || spanOf(candidates, candidates.length, gap) <= available))
    return { pulled: candidates.length, namesFit: true };

  // From `candidates.length` rather than one below it: with something already behind the control, every
  // candidate staying inline is a real answer that still has to pay for the control beside them.
  for (let pulled = candidates.length; pulled >= 0; pulled--) {
    const room = available - spanOf(candidates, pulled, gap) - gap;
    const overflowed = candidates.length - pulled + alwaysOverflowed;

    if ((namesWidths[overflowed - 1] ?? Infinity) <= room) return { pulled, namesFit: true };
    if ((countWidths[overflowed - 1] ?? Infinity) <= room) return { pulled, namesFit: false };
  }

  return { pulled: 0, namesFit: false };
}
