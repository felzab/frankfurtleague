/**
 * Groups `right` under `left` by a shared id, attaching each group at `targetKey`.
 *
 * `TKey extends string` rather than a plain `string` is what makes the return type name the attached
 * property instead of widening to an index signature — with the plain version the compiler could not
 * know the property was called `spiele`, which is what forced the codebase's only `as unknown as` at
 * the playoffs call site.
 *
 * The return is `Omit<L, TKey> & …`, not `L & …`. At runtime the spread means `targetKey` *replaces*
 * any same-named key on `L`; an intersection would instead claim the property has both types. With
 * `targetKey: "name"` that yields `string & FLSpiel[]`, so `.toUpperCase()` compiles and throws.
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
        // .slice() so each left row owns its group. Without it, two rows sharing an id receive the
        // same array instance, and an in-place sort or push on one silently mutates the other --
        // inconsistent with the unmatched path, which builds a fresh [] every time.
        [targetKey]: map.get(item[leftIdKey] as IdType)?.slice() ?? [],
      }) as Omit<L, TKey> & { [P in TKey]: R[] },
  );
}
