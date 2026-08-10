/**
 * SHARED · list grouping
 *
 * Groups `right` under `left` by a shared id, attaching each group at `targetKey`.
 * `TKey extends string` is what makes the return type name the attached property instead of
 * widening — the plain version forced the codebase's only `as unknown as`. The return is
 * `Omit<L, TKey> & …`, not `L & …`: at runtime the spread REPLACES a same-named key, and an
 * intersection would claim both types, so `.toUpperCase()` compiles and throws.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- L and R are arbitrary row shapes */
export function joinCollections<
  L extends Record<string, any>,
  R extends Record<string, any>,
  /* eslint-enable @typescript-eslint/no-explicit-any */
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
}): (Omit<L, TKey> & { [P in TKey]: R[] })[] {
  type IdType = L[K] & (string | number | symbol);

  const map = new Map<IdType, R[]>();

  for (const item of right) {
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
        // .slice() so each left row owns its group. Without it, two rows sharing an id receive the
        // same array instance, and an in-place sort or push on one silently mutates the other --
        // inconsistent with the unmatched path, which builds a fresh [] every time.
        [targetKey]: map.get(item[leftIdKey] as IdType)?.slice() ?? [],
      }) as Omit<L, TKey> & { [P in TKey]: R[] },
  );
}
