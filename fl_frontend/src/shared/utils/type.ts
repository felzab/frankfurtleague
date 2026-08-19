/**
 * `Object.entries` widens keys to `string`, losing the union on a record keyed by a literal; this asserts it back. Safe
 * only for a known-shape object literal — never for anything parsed from outside the program.
 */
export function typedObjectEntries<T extends object>(obj: T) {
  return Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
}
