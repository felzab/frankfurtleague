/**
 * What an emptied `NumberField` records. **`null` is "nobody entered one"; `0` is a number somebody typed** — a
 * fixture with no goals recorded and a fixture that ended 0:0 are different facts, and a draft that spells them
 * alike has already lost the difference. react-aria reports a cleared box as `NaN`, and `undefined` before the
 * first commit.
 *
 * The payload schemas keep their `z.int()`, whose type-check message is the German for an empty field, so a `null`
 * left in the draft is refused at the submit and never reaches the backend.
 */
export function enteredNumber(next: number | undefined): number | null {
  return next === undefined || Number.isNaN(next) ? null : next;
}
