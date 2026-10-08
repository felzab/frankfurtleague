import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sliceBetween } from "@/shared/testing/sourceText.ts";

import { AKTION_COLLECTION_LABELS } from "./constants.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

// Source text rather than an import: both halves of the set are Python, and the frontend holds no
// second copy of either that could be read in their place.
const COLLECTIONS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "collections.py"), "utf8");
const CONSTRAINTS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "constraints.py"), "utf8");

/** The enum's own body, cut at the module's end: it is the last declaration there. */
const ENUM_SOURCE = sliceBetween(COLLECTIONS, "class Collection(StrEnum):", null);

/** Every member, by the name the derivation below excludes one of and by the stored name a row carries. */
const MEMBERS = new Map(
  [...ENUM_SOURCE.matchAll(/^ {4}([A-Z_]+) = "([^"]+)"$/gm)].flatMap((match) => (match[1] && match[2] ? [[match[1], match[2]] as const] : [])),
);

/**
 * The members the log never records, each with why. A member the derivation starts leaving out fails the
 * first case below until it is named here, so a collection never reaches the log's blind spot unread.
 */
const LEFT_OUT: Readonly<Record<string, string>> = {
  AKTIONEN: "the log never records itself",
  DROSSELUNG: "a day's write count is operational state, written past the helpers that record (`fl_backend/app/core/drosselung.py`)",
};

/**
 * The members the derivation excludes, read off it. Any other shape leaves this `undefined`, and the case
 * below says the derivation moved.
 */
function excludedByTheDerivation(): string[] | undefined {
  const set = /^_LOGGED_COLLECTIONS = \[str\(name\) for name in Collection if name not in \{([^}]*)\}\]$/m.exec(CONSTRAINTS)?.[1];
  const members = set?.split(",").map((entry) => /^\s*Collection\.([A-Z_]+)\s*$/.exec(entry)?.[1]);

  return members?.every((member) => member !== undefined) ? members : undefined;
}

const EXCLUDED = excludedByTheDerivation();

/** What `fl_backend/app/core/constraints.py :: _LOGGED_COLLECTIONS` evaluates to, which the log's validator enumerates. */
const LOGGED = [...MEMBERS].filter(([member]) => !EXCLUDED?.includes(member)).map(([, stored]) => stored);

describe("the areas the change log names against the collections the backend records", () => {
  /* First, so a boundary or a derivation that stopped matching fails here rather than leaving every
     comparison below over an empty or an unexcluded set. */
  it("reads the enum and exactly the members the derivation leaves out, each named with why", () => {
    assert.ok(MEMBERS.size > 1, `the enum parsed to ${String(MEMBERS.size)} members, so every comparison over it is vacuous`);
    assert.ok(EXCLUDED !== undefined, "_LOGGED_COLLECTIONS is no longer derived by excluding a set of members of Collection");
    assert.deepEqual(
      EXCLUDED.filter((member) => !MEMBERS.has(member)),
      [],
      "the derivation excludes a member the enum does not declare",
    );
    assert.deepEqual(
      [...EXCLUDED].sort(),
      Object.keys(LEFT_OUT).sort(),
      "the derivation leaves out a member LEFT_OUT does not name, or the reverse",
    );
    assert.equal(LOGGED.length, MEMBERS.size - EXCLUDED.length);
  });

  /* THE COUPLING. A collection the backend starts recording lists under its stored word and matches no
     area the filter offers until it is named here; a name kept for one it stopped recording is an area
     that leads nowhere. */
  it("names every collection the log records, and none it does not", () => {
    assert.deepEqual(Object.keys(AKTION_COLLECTION_LABELS).sort(), [...LOGGED].sort());
  });

  it("names no two areas alike, which the filter would offer as one word twice", () => {
    const labels = Object.values(AKTION_COLLECTION_LABELS);

    assert.equal(new Set(labels).size, labels.length);
  });
});
