// Necessary!
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function joinCollections<L extends Record<string, any>, R extends Record<string, any>, K extends keyof L, J extends keyof R>({
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
  targetKey: string;
}) {
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

  return left.map((item) => ({
    ...item,
    // Safely retrieve using the explicit IdType
    [targetKey]: map.get(item[leftIdKey] as IdType) || [],
  }));
}
