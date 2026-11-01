import { TIME_ZONE } from "@/core/format";

// Europe/Berlin, matching how the backend computes "today": the server's own clock would put the two out
// of step for an hour a day.
const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
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
