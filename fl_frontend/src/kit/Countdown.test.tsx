// @vitest-environment jsdom
import { act } from "react";

import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { DAY_MS, HOUR_MS } from "@/core/timeUnits";

import { Countdown } from "./Countdown";

const START = "2027-03-13T17:00:00.000Z";
const AT_START = Date.parse(START);
// Two days, three hours and four minutes before the season's start, and half a minute more.
const SEED = AT_START - 2 * DAY_MS - 3 * HOUR_MS - 4 * 60_000 - 30_000;

/** The three figures the count shows, in its order. */
const figuresOf = (root: HTMLElement) => [...root.querySelectorAll('[role="timer"] > span')].map((cell) => cell.firstElementChild?.textContent);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what is left until the season's start", () => {
  it("never counts below zero once the start has passed", () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(
      <Countdown
        start={START}
        seed={AT_START + HOUR_MS}
      />,
    );
    expect(figuresOf(container)).toStrictEqual(["0", "0", "0"]);
  });
});

describe("the countdown", () => {
  it("hydrates the server's markup without a mismatch, then counts from the visitor's clock", async () => {
    const markup = renderToString(
      <Countdown
        start={START}
        seed={SEED}
      />,
    );
    const container = document.createElement("div");
    container.innerHTML = markup;
    document.body.append(container);
    expect(figuresOf(container)).toStrictEqual(["2", "3", "4"]);
    expect(container.textContent).toContain(COPY.landing.saison.days);

    // The visitor's clock stands ten minutes past the server's, so a first render reading it would differ.
    vi.setSystemTime(SEED + 10 * 60_000);
    const mismatches: unknown[] = [];
    await act(async () => {
      hydrateRoot(
        container,
        <Countdown
          start={START}
          seed={SEED}
        />,
        { onRecoverableError: (error) => mismatches.push(error) },
      );
    });
    expect(mismatches).toStrictEqual([]);
    expect(figuresOf(container)).toStrictEqual(["2", "2", "54"]);

    // Thirty seconds on, the next whole minute runs out and the minutes figure drops.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(figuresOf(container)).toStrictEqual(["2", "2", "53"]);
    container.remove();
  });
});
