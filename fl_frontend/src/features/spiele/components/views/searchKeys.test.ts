import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/** Source text rather than a render, `sonderereignisPick.test.ts`'s idiom and for its reason. */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "SpielsucheView.tsx"), "utf8");

/** The list alone, so a field named anywhere else in the view cannot satisfy an assertion below. */
const KEYS = (SOURCE.split("const SEARCH_KEYS = [")[1] ?? "").split("] as const;")[0] ?? "";

describe("the fixture search's keys", () => {
  /* First, so a boundary that stopped matching fails here rather than everywhere below. */
  it("cuts the key list out of the file before reading it", () => {
    assert.ok(KEYS.includes('"team1.name"'), "the key list is outside its slice");
    assert.ok(!KEYS.includes("useMemo"), "the slice runs on into the component");
  });

  /* No surface renders the stored spelling, so nobody has seen one to type, and a key for it would
     only widen a numeric query: "2026-03" would then also reach a fixture played in November. */
  it("names the date a reader sees and not the one the document stores", () => {
    assert.ok(KEYS.includes('"searchable_datum"'));
    assert.ok(!KEYS.includes('"datum"'), "the stored date is a search key");
  });

  /* A copy built for the search and left out of the list is work nothing reads, while the view
     reads as though that spelling were reachable. */
  it("names every searchable copy the view derives", () => {
    const derived = [...SOURCE.matchAll(/^\s+(searchable_\w+):/gm)].map((match) => match[1]);
    assert.ok(derived.length > 0, "the view derives no searchable copy");
    for (const field of derived) assert.ok(KEYS.includes(`"${field}"`), `${field} is derived and never searched`);
  });

  /* One formatter for both spellings, or the searched date drifts off the rendered one the day the
     rendered format changes. */
  it("derives the searchable date through the formatter the cards render through", () => {
    assert.match(SOURCE, /searchable_datum: s\.datum === null \? null : formatSpielDatum\(s\.datum\)/);
  });
});
