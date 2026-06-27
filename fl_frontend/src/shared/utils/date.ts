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
  // Returns an array of objects like: [{ type: "year", value: "2026" }, ...]
  const parts = formatter.formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";

  return `${year}-${month}-${day}`;
};
