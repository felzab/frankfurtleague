import path from "node:path";

import { filesUnder } from "@/test-support/treeWalk";
import { describe, expect, it } from "vitest";

const APP_DIR = import.meta.dirname;

/* Next rewrites an intercepted address by the page the visitor stands on, which no build, type or render
   below the journeys sees: an interceptor's harm shows only once a browser walks from one page to another. */
const INTERCEPTING = /^\(\.\)/;
const GROUP = /^\([^()/]+\)$/;
const SLOT = /^@/;
const DYNAMIC = /^\[/;

const INTERCEPTORS = filesUnder(APP_DIR, (name) => /^page\.[jt]sx?$/.test(name), 1)
  .map((file) => path.relative(APP_DIR, path.dirname(file)).split(path.sep))
  .filter((segments) => segments.some((segment) => INTERCEPTING.test(segment)))
  .map((segments) => ({ shown: segments.join("/"), segments }));

/** The address an interceptor answers, each dynamic segment reduced to its kind, since a rewrite matches by shape whatever the param is named. */
const addressOf = (segments: string[]) =>
  "/" +
  segments
    .filter((segment) => !GROUP.test(segment) && !SLOT.test(segment))
    .map((segment) => segment.replace(INTERCEPTING, ""))
    .map((segment) => (DYNAMIC.test(segment) ? (segment.startsWith("[[") ? "[[...]]" : segment.startsWith("[...") ? "[...]" : "[]") : segment))
    .join("/");

describe("the intercepting pages", () => {
  it("finds the interceptors it judges", () => {
    expect(INTERCEPTORS.length).toBeGreaterThan(0);
  });

  /* A group is no level of the address: a slot of `(classic)` intercepting `(.)saisons` reaches from `/`, so from every
     page of the site, while the group's layout draws the slot on its own pages alone. */
  it.each(INTERCEPTORS)("$shown stands under no route group", ({ segments }) => {
    const above = segments.slice(
      0,
      segments.findIndex((segment) => INTERCEPTING.test(segment)),
    );
    expect(above.filter((segment) => GROUP.test(segment))).toStrictEqual([]);
  });

  // From a page two levels both hold, their rewrites compete in an order Next documents nowhere.
  it("gives each intercepted address one interceptor", () => {
    const byAddress = Map.groupBy(INTERCEPTORS, ({ segments }) => addressOf(segments));
    const shared = [...byAddress].filter(([, there]) => there.length > 1).map(([address, there]) => [address, there.map(({ shown }) => shown)]);
    expect(shared).toStrictEqual([]);
  });
});
