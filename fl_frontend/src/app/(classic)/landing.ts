import { cacheLife, cacheTag } from "next/cache";

import { TIME_ZONE } from "@/core/format";
import { saisonsGetLanding } from "@/core/generated/client/sdk";
import { SITE_CACHE_TAG } from "@/core/siteCache";

import type { CalendarDay, Uhrzeit } from "@/core/format";
import type { FLLandingResponse } from "@/core/generated/client/types";

/**
 * The landing's one read: the season the site is on, its state, figures and schools, and the application window
 * open today, which the backend judges by the rule the submission refuses on (D466). Cached under the site-wide
 * tag for minutes, as every league read is, so a save clears it.
 */
export async function readLanding(): Promise<FLLandingResponse> {
  "use cache";

  cacheTag(SITE_CACHE_TAG);
  cacheLife("minutes");

  return saisonsGetLanding();
}

/** How far Berlin's clock stands ahead of UTC at `instant`, in milliseconds. */
function berlinOffset(instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - instant;
}

/**
 * The instant a match stored as a Berlin day and time starts, as an ISO string; an untimed one counts from the
 * day's first minute. The offset is read at the guess and again at the result, so a kick-off on the day the
 * clocks change still lands on the hour the Spielplan prints.
 */
export function kickoffInstant(datum: CalendarDay, uhrzeit: Uhrzeit | null): string {
  const [year = 0, month = 1, day = 1] = datum.split("-").map(Number);
  const [hour = 0, minute = 0] = (uhrzeit ?? "00:00").split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - berlinOffset(wall);
  return new Date(wall - berlinOffset(first)).toISOString();
}
