/**
 * `Object.entries` widens a literal-keyed record's keys to `string`; the cast asserts the union back. Sound wherever no
 * key outside `keyof T` can reach the object — an object literal, or a strict Zod record, which refuses an unrecognised
 * key.
 */
export function typedObjectEntries<T extends object>(obj: T) {
  // `Object.entries` yields only keys the object HAS, so an optional key's value is present at every
  // entry: the `undefined` that indexing an optional property adds is a fiction every caller would
  // otherwise guard.
  return Object.entries(obj) as Array<[keyof T, Required<T>[keyof T]]>;
}
