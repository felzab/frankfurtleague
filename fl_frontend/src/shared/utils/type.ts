/**
 * `Object.entries` widens keys to `string`, losing the union on a record keyed by a literal; this asserts it back. Safe
 * only for a known-shape object literal — never for anything parsed from outside the program.
 */
export function typedObjectEntries<T extends object>(obj: T) {
  // `Object.entries` yields only keys the object HAS, so an optional key's value is present at every
  // entry: the `undefined` that indexing an optional property adds is a fiction every caller would
  // otherwise guard.
  return Object.entries(obj) as Array<[keyof T, Required<T>[keyof T]]>;
}
