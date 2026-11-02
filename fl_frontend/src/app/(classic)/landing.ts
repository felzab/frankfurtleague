import { cacheLife, cacheTag } from "next/cache";

import { COPY } from "@/core/copy";
import { TIME_ZONE } from "@/core/format";
import { saisonsGetLanding } from "@/core/generated/client/sdk";
import { SERVER_COPY } from "@/core/serverCopy";
import { SITE_CACHE_TAG } from "@/core/siteCache";

import { matchRowOf } from "../saisons/[saison]/spielplan";

import type { CalendarDay, Uhrzeit } from "@/core/format";
import type { FLBewerbungWindow, FLLandingResponse, FLLandingSaison } from "@/core/generated/client/types";
import type { SaisonBlock } from "@/kit/SaisonBlock";
import type { Route } from "next";
import type { ComponentProps } from "react";

/** What the season card shows, by the season's state. */
type SaisonState = ComponentProps<typeof SaisonBlock>["state"];

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

/** The application form for the season whose window is open. */
export const formOf = (window: FLBewerbungWindow) => `/bewerbung/${window.saison_id}` as Route;

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

/** The instant a match stored as a Berlin day and time starts; an untimed one counts from the day's first minute. */
function kickoffInstant(datum: CalendarDay, uhrzeit: Uhrzeit | null): string {
  const [year = 0, month = 1, day = 1] = datum.split("-").map(Number);
  const [hour = 0, minute = 0] = (uhrzeit ?? "00:00").split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - berlinOffset(wall);
  return new Date(wall - berlinOffset(first)).toISOString();
}

/** A season still being played: its last result and its next match, each where it has one. */
function runningOf(saison: FLLandingSaison): SaisonState {
  const [last] = saison.recent;
  const [next] = saison.upcoming;
  return {
    kind: "running",
    ...(last === undefined ? {} : { last: matchRowOf(last) }),
    ...(next === undefined ? {} : { next: matchRowOf(next) }),
  };
}

/**
 * Where the season stands, as its card beside the hero shows it: before the start, the countdown to its first
 * kick-off once one is dated, else the open window, else the one sentence that nothing is dated; while it runs,
 * its last result and next match; once all four places are in, the podium.
 */
export function stateOf(saison: FLLandingSaison, window: FLBewerbungWindow | null): SaisonState {
  switch (saison.state) {
    case "before_start": {
      const kickoff = saison.first_kickoff;
      if (kickoff !== null) {
        const datum = kickoff.datum as CalendarDay;
        const uhrzeit = kickoff.uhrzeit as Uhrzeit | null;
        return {
          kind: "countdown",
          kickoff: kickoffInstant(datum, uhrzeit),
          when: COPY.spielplan.when(datum, uhrzeit),
          opening: {
            spieltag: SERVER_COPY.landing.saison.spieltag(kickoff.spieltag_position),
            home: kickoff.team1.shorthand,
            away: kickoff.team2.shorthand,
          },
        };
      }
      return window === null ? { kind: "undated" } : { kind: "window", until: window.bis as CalendarDay, apply: formOf(window) };
    }
    case "running":
      return runningOf(saison);
    case "decided": {
      const placed = (platz: number) => saison.podium.find((place) => place.platz === platz);
      const [first, second, third, fourth] = [1, 2, 3, 4].map(placed);
      // Every season with a K.-o.-Runde has places 1 to 4 (D497); one still missing a place reads as undecided.
      if (first === undefined || second === undefined || third === undefined || fourth === undefined) return runningOf(saison);
      const club = (place: typeof first) => ({ name: place.name, kuerzel: place.shorthand });
      return { kind: "decided", places: [club(first), club(second), club(third), club(fourth)] };
    }
  }
}
