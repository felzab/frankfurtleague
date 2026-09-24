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
 * The one member the log never records, read off the derivation itself. A second exclusion, or any other
 * shape, leaves this `undefined` and the case below says the derivation moved.
 */
const EXCLUDED = /^_LOGGED_COLLECTIONS = \[str\(name\) for name in Collection if name is not Collection\.([A-Z_]+)\]$/m.exec(CONSTRAINTS)?.[1];

/** What `fl_backend/app/core/constraints.py :: _LOGGED_COLLECTIONS` evaluates to, which the log's validator enumerates. */
const LOGGED = [...MEMBERS].filter(([member]) => member !== EXCLUDED).map(([, stored]) => stored);

describe("the areas the change log names against the collections the backend records", () => {
  /* First, so a boundary or a derivation that stopped matching fails here rather than leaving every
     comparison below over an empty or an unexcluded set. */
  it("reads the enum and the one member the derivation leaves out", () => {
    assert.ok(MEMBERS.size > 1, `the enum parsed to ${String(MEMBERS.size)} members, so every comparison over it is vacuous`);
    assert.ok(EXCLUDED !== undefined, "_LOGGED_COLLECTIONS is no longer derived by excluding one member of Collection");
    assert.ok(MEMBERS.has(EXCLUDED), `the derivation excludes ${EXCLUDED}, which the enum does not declare`);
    assert.equal(LOGGED.length, MEMBERS.size - 1);
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
