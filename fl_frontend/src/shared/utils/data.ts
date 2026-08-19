/**
 * The return is `Omit<L, TKey> & …`, never `L & …`: the spread replaces a same-named key at runtime, so an intersection
 * claims both types and `.toUpperCase()` compiles and throws.
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
        // .slice() so each left row owns its group: two rows sharing an id would otherwise receive one
        // array instance, and a sort or push through either silently reaches the other.
        [targetKey]: map.get(item[leftIdKey] as IdType)?.slice() ?? [],
      }) as Omit<L, TKey> & { [P in TKey]: R[] },
  );
}
