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

export const getLeagueTodayString = (): string => {
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
