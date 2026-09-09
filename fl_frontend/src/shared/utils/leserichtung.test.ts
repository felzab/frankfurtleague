import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leserichtungHref, leserichtungHrefFromRoute, parseLeserichtung, umgekehrt } from "./leserichtung.ts";

/** The URL shapes the two capped lists write, each carrying something a reversal must not drop. */
const LIST_URLS: Record<string, string | string[]>[] = [
  {},
  { collection: "teams,spiele" },
  { operation: "insert", saison_id: "2026" },
  { document_id: "68c1f0a2b3c4d5e6f7a8b9c0", order: "asc" },
  { q: "name@beispiel.de", herkunft: ["system", "public"] },
  { status: ["eingereicht", "abgelehnt"], order: "desc" },
];

/** One URL shape as a query string, repeated keys and all. */
function asSearch(params: Record<string, string | string[]>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const single of Array.isArray(value) ? value : [value]) search.append(key, single);

  return search;
}

/** A built href read back the way a page reads its own route, so one case can follow a second press. */
function asRoute(href: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(href.slice(1)));
}

describe("parseLeserichtung", () => {
  it("keeps the newest end unless the URL asks for the other one", () => {
    for (const params of [{}, { order: "" }, { order: "ASC" }, { order: ["asc"] }, { order: "unsinn" }]) {
      assert.equal(parseLeserichtung(params), "desc");
    }
    assert.equal(parseLeserichtung({ order: "asc" }), "asc");
  });
});

describe("umgekehrt", () => {
  it("answers the other end from either one", () => {
    assert.equal(umgekehrt("desc"), "asc");
    assert.equal(umgekehrt("asc"), "desc");
  });
});

describe("leserichtungHref", () => {
  it("writes the oldest end as a parameter of its own", () => {
    assert.equal(leserichtungHref(new URLSearchParams(), "asc"), "?order=asc");
  });

  /* The default end is the ABSENCE of the parameter, so a pasted link carries only what somebody
     chose; a builder writing `order=desc` for it would pass every other case in this file. */
  it("leaves no order behind at all on the way back to the newest end", () => {
    assert.equal(leserichtungHref(new URLSearchParams("order=asc"), "desc"), "?");
    assert.equal(leserichtungHref(new URLSearchParams("order=asc&q=x"), "desc"), "?q=x");
  });

  it("rebuilds the parameter rather than appending beside the one already there", () => {
    assert.equal(leserichtungHref(new URLSearchParams("order=asc&q=x"), "asc"), "?q=x&order=asc");
  });

  it("carries every other parameter across, repeated keys included", () => {
    assert.equal(
      leserichtungHref(new URLSearchParams("saison_id=2025&status=a&status=b"), "asc"),
      "?saison_id=2025&status=a&status=b&order=asc",
    );
  });

  /* Both capped lists reverse through this one builder, so a narrowing it dropped would widen a read
     the reader had just narrowed, with the pills still saying otherwise. */
  it("keeps every narrowing either list wrote", () => {
    for (const params of LIST_URLS) {
      const richtung = parseLeserichtung(params);
      const reversed = new URLSearchParams(leserichtungHref(asSearch(params), umgekehrt(richtung)).slice(1));

      for (const [key, value] of Object.entries(params)) {
        if (key === "order") continue;
        assert.deepEqual(reversed.getAll(key), Array.isArray(value) ? value : [value], `\`${key}\` was dropped by the reversal`);
      }
      assert.equal(reversed.get("order"), richtung === "desc" ? "asc" : null);
    }
  });

  /* A second press reads the end the first one left, which is what makes the control's two rows a
     state and its alternative rather than two one-way trips. */
  it("reads back the end it started at after two reversals", () => {
    for (const params of LIST_URLS) {
      const start = parseLeserichtung(params);
      const einmal = leserichtungHref(asSearch(params), umgekehrt(start));

      assert.equal(parseLeserichtung(asRoute(einmal)), umgekehrt(start));
      assert.equal(parseLeserichtung(asRoute(leserichtungHref(new URLSearchParams(einmal.slice(1)), start))), start);
    }
  });
});

describe("leserichtungHrefFromRoute", () => {
  /** One route's parameters as a Server Component receives them: a string, a repeated key and an absent one. */
  const ROUTE = { q: "schule", status: ["eingereicht", "abgelehnt"], order: "asc", trace_id: undefined };

  /* The notice's link is built off the route and the bar's control off the live query string, so the
     two forms disagreeing would put two URLs behind one state on one page. */
  it("agrees with the query-string form on a string, an array and an absent key", () => {
    const live = asSearch({ q: "schule", status: ["eingereicht", "abgelehnt"], order: "asc" });

    for (const ziel of ["asc", "desc"] as const) {
      assert.equal(leserichtungHrefFromRoute(ROUTE, ziel), leserichtungHref(live, ziel));
    }
  });

  it("drops an absent key rather than writing it out as a value", () => {
    assert.equal(leserichtungHrefFromRoute({ q: undefined }, "asc"), "?order=asc");
  });
});
