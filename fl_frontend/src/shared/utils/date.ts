/**
 * SHARED · date helpers
 *
 * Dates travel as `YYYY-MM-DD` strings end to end and are compared as strings, which works only
 * because that format sorts lexicographically. Nothing here parses them into `Date` objects for
 * comparison, and it should stay that way — a `Date` reintroduces timezone ambiguity the string form
 * does not have.
 *
 * "Today" is always Europe/Berlin, matching how the backend computes it. Using the server's local
 * clock instead would put the two out of step for an hour a day.
 *
 * `sortByDate` sorts nulls LAST regardless of direction: an unscheduled match belongs at the end of a
 * fixture list, not at the top.
 */

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

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const getGermanTodayStr = (): string => {
  const parts = formatter.formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
};
