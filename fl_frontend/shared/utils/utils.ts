import type { FLTeamAddress } from "@/features/teams/types";

export function typedObjectEntries<T extends object>(obj: T) {
  return Object.entries(obj) as Array<[keyof T, T[keyof T]]>;
}

export function formatAddress(address?: FLTeamAddress): string {
  if (!address) return "Keine Adresse hinterlegt";

  return `${address.strasse} ${address.hausnummer}, ${address.plz} ${address.stadt} (${address.stadtteil})`;
}

export function sortByDate<T>({ arr, key }: { arr: T[]; key: keyof T }): T[] {
  return [...arr].sort((a, b) => {
    const vA = a[key] ?? null;
    const vB = b[key] ?? null;
    if (vA === null && vB === null) return 0;
    if (vA === null) return 1;
    if (vB === null) return -1;
    return String(vA).localeCompare(String(vB));
  });
}

export const getGermanDateStr = (): string => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  // Returns an array of objects like: [{ type: "year", value: "2026" }, ...]
  const parts = formatter.formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
};

export function joinCollections<L, R>({
  left,
  right,
  leftIdKey,
  rightIdKey,
  targetKey,
}: {
  left: L[];
  right: R[];
  leftIdKey: keyof L;
  rightIdKey: keyof R;
  targetKey: string;
}) {
  const map = new Map<any, R[]>();

  for (const item of right) {
    const key = item[rightIdKey];
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }

  return left.map((item) => ({
    ...item,
    [targetKey]: map.get(item[leftIdKey] as any) || [],
  }));
}
