/**
 * Groups `right` under `left` by a shared id, attaching each group at `targetKey`.
 *
 * `TKey extends string` rather than a plain `string` is what makes the return type
 * `(L & { [P in TKey]: R[] })[]` instead of `(L & { [x: string]: R[] })[]`. With the plain version
 * the compiler could not know the attached property was called `spiele`, which is what forced the
 * codebase's only `as unknown as` at the playoffs call site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- L and R are arbitrary row shapes
export function joinCollections<
  L extends Record<string, any>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  R extends Record<string, any>,
  K extends keyof L,
  J extends keyof R,
  TKey extends string,
>({
  left,
  right,
  leftIdKey,
  rightIdKey,
  targetKey,
}: {
  left: L[];
  right: R[];
  leftIdKey: K;
  rightIdKey: J;
  targetKey: TKey;
}): (L & { [P in TKey]: R[] })[] {
  // We constrain the ID type to be a valid Map key (string | number | symbol)
  type IdType = L[K] & (string | number | symbol);

  const map = new Map<IdType, R[]>();

  for (const item of right) {
    // We cast to IdType because we are certain of the relationship
    const key = item[rightIdKey] as IdType;

    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(item);
  }

  return left.map(
    (item) =>
      ({
        ...item,
        // Safely retrieve using the explicit IdType
        [targetKey]: map.get(item[leftIdKey] as IdType) || [],
      }) as L & { [P in TKey]: R[] },
  );
}
