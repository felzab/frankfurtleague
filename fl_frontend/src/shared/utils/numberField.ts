/**
 * What an emptied `NumberField` records. **`null` is "nobody entered one"; `0` is a number somebody typed** — a
 * fixture with no goals recorded and one that ended 0:0 are different facts, and a draft spelling them alike
 * has already lost the difference.
 */
export function enteredNumber(next: number | undefined): number | null {
  // `NaN` is how react-aria reports a cleared box, `undefined` the state before the first commit. A `null`
  // left in the draft is refused at submit: every payload schema words its own type check, so the empty
  // box draws German.
  return next === undefined || Number.isNaN(next) ? null : next;
}
