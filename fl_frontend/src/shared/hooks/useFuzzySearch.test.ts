import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render } from "@testing-library/react";

import { carriesEveryDate, splitDateQuery, useFuzzySearch } from "./useFuzzySearch.ts";

interface Row {
  name: string;
  ort: { name: string };
  searchable_datum: string | null;
}

/** Three fixtures a day apart, which is what a fuzzy reader of a date cannot tell apart. */
const ROWS: Row[] = [
  { name: "SG Alpha", ort: { name: "Sportplatz Ost" }, searchable_datum: "12.03.2026" },
  { name: "TSV Beta", ort: { name: "Halle West" }, searchable_datum: "13.03.2026" },
  { name: "FC Gamma", ort: { name: "Halle West" }, searchable_datum: "12.03.2026" },
];

const KEYS = ["name", "ort.name", "searchable_datum"] as const;

function Probe({ query }: { query: string }): ReturnType<typeof h> {
  const found = useFuzzySearch({ items: ROWS, keys: KEYS, query });

  return h("p", null, found.map((row) => row.name).join(" | "));
}

const foundFor = (query: string): string[] => {
  const { container, unmount } = render(h(Probe, { query }));
  const shown = container.textContent;
  unmount();

  return shown === "" ? [] : shown.split(" | ");
};

describe("the search a reader types a date into", () => {
  /* At `threshold: 0.3` every date of the same month is within edit distance of every other, so a
     reader who types the day they are looking at is answered with the days around it. */
  it("answers a complete date with that day alone", () => {
    assert.deepEqual(foundFor("12.03.2026"), ["SG Alpha", "FC Gamma"]);
  });

  it("leaves every other word fuzzy, and narrows the day by it", () => {
    assert.deepEqual(foundFor("12.03.2026 Halle"), ["FC Gamma"]);
    // A near miss on a name still matches, which is what the fuzzy half is for.
    assert.deepEqual(foundFor("Alpa"), ["SG Alpha"]);
  });

  it("finds nothing for a day nothing is played on", () => {
    assert.deepEqual(foundFor("14.03.2026"), []);
  });

  /* A partial date is not the exact query a whole one is: a reader typing a month is asking for the
     month, and the fuzzy half is what answers that. */
  it("reads only a whole day as a date", () => {
    assert.deepEqual(splitDateQuery("12.03.2026 Halle"), { dates: ["12.03.2026"], rest: "Halle" });
    assert.deepEqual(splitDateQuery("12.03. 2026"), { dates: [], rest: "12.03. 2026" });
  });

  it("walks a dotted key and reads no date off an unsearched field", () => {
    assert.ok(carriesEveryDate({ a: { b: "12.03.2026" } }, ["a.b"], ["12.03.2026"]));
    assert.ok(!carriesEveryDate({ a: { b: "12.03.2026" } }, ["a.c"], ["12.03.2026"]));
    assert.ok(!carriesEveryDate({ a: null }, ["a.b"], ["12.03.2026"]), "a null on the path is walked into");
  });
});
