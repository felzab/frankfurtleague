"use client";

import { useEffect, useState } from "react";

import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { formatNumber } from "@/core/format";
import { DAY_MS, HOUR_MS } from "@/core/timeUnits";

const MINUTE_MS = 60 * 1000;

/** What is left until `kickoff` at `at`, both in milliseconds: whole days, hours and minutes, none below zero. */
function remaining(kickoff: number, at: number) {
  const left = Math.max(0, kickoff - at);
  return {
    days: Math.floor(left / DAY_MS),
    hours: Math.floor((left % DAY_MS) / HOUR_MS),
    minutes: Math.floor((left % HOUR_MS) / MINUTE_MS),
  };
}

/**
 * The days, hours and minutes left until the season's first kick-off, the one part of the landing that runs
 * on the client. Its first render, on the server and again while the page hydrates, counts from `seed`, the
 * instant the server rendered at, so both write the same markup; once hydrated it counts from the visitor's
 * clock and wakes as each minute runs out, re-rendering these figures alone. No seconds: a figure ticking
 * every second never rests.
 */
export function Countdown({ kickoff, seed }: { kickoff: string; seed: number }) {
  const target = Date.parse(kickoff);
  const [at, setAt] = useState(seed);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const current = now().getTime();
      setAt(current);
      const left = target - current;
      // The minutes figure drops once what is left passes its next whole minute.
      if (left > 0) timer = setTimeout(tick, (left % MINUTE_MS) + 1);
    };
    tick();
    return () => {
      clearTimeout(timer);
    };
  }, [target]);

  const { days, hours, minutes } = remaining(target, at);
  const units = [
    [days, COPY.landing.saison.days],
    [hours, COPY.landing.saison.hours],
    [minutes, COPY.landing.saison.minutes],
  ] as const;
  return (
    <div
      role="timer"
      className="grid grid-cols-3 gap-2">
      {units.map(([figure, unit]) => (
        <span
          key={unit}
          className="grid justify-items-center gap-0.5 rounded-lg bg-bg-surface px-2 py-3">
          {/* Board: the figures' size, 32 px in Anton. */}
          <span className="font-heading text-3xl tracking-display">{formatNumber(figure)}</span>
          <span className="text-xs text-fg-muted">{unit}</span>
        </span>
      ))}
    </div>
  );
}
