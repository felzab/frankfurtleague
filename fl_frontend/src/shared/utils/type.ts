/**
 * SHARED · type helpers
 *
 * `Object.entries` widens keys to `string`, which loses the union type on a record keyed by a literal.
 * This asserts it back. Safe only because the input is a known-shape object literal — do not use it on
 * anything parsed from outside the program.
 */

export function typedObjectEntries<T extends object>(obj: T) {
  return Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
}
