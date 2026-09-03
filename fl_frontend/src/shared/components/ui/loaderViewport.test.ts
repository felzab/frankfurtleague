import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/** The kinds a box can be sized in. A height in `globals.css` reaches every page and no component names it. */
const SUFFIXE = [".ts", ".tsx", ".css"];

/**
 * Each kind's test form, derived rather than typed: an exclusion written for one suffix where the
 * walk takes three leaves the others' fixtures read as text the tree ships.
 */
const PRUEFSUFFIXE = SUFFIXE.map((suffix) => `.test${suffix}`);

/** A file the browser is served. A fixture naming a box reaches no page, so a hit in one is not a defect. */
const gefegt = (name: string): boolean =>
  SUFFIXE.some((suffix) => name.endsWith(suffix)) && !PRUEFSUFFIXE.some((suffix) => name.endsWith(suffix));

/** Discovered rather than listed: a named handful is the boxes somebody remembered. */
const collectSources = (dir: string): string[] => filesUnder(dir, gefegt, 350);

/** `100dvh` and `dvh` generally are the answer, so the search is for the unit that is not. */
const BARE_VH = /(?<![a-z-])\d+vh\b|\bvh-screen\b/;

const sources = collectSources(SRC_DIR).map(
  (file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")] as const,
);

describe("the unit a viewport-sized box may be expressed in", () => {
  it("reads the whole tree, so a new box is swept without being remembered", () => {
    for (const suffix of SUFFIXE) {
      assert.ok(
        sources.some(([file]) => file.endsWith(suffix)),
        `no ${suffix} file is being read, so a box written in one is swept by nothing`,
      );
    }

    // By the name rather than by the list the walk filters on: a check reading that list back cannot
    // fail, a suffix missing from it dropping out of both sides at once.
    assert.deepEqual(
      sources.filter(([file]) => file.split("/").at(-1)?.includes(".test.")).map(([file]) => file),
      [],
      "a fixture is being read as text the tree ships",
    );
  });

  /* `vh` is the chrome-HIDDEN height on a phone, so a box sized in it outgrows the visible area and scrolls a
     page that should end at the fold. Nothing in the toolchain sees this: it type-checks, lints, builds, and
     shows up on a device and nowhere else. */
  it("sizes every box in dvh, never vh", () => {
    const offenders = sources.filter(([, text]) => BARE_VH.test(text)).map(([file]) => file);

    assert.deepEqual(offenders, [], `${offenders.join(", ")} sizes a box in vh, which overshoots the viewport on a phone`);
  });
});
