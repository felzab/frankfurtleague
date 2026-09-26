import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * The one kind a box is sized in that ESLint does not lint: `fl_frontend/eslint.config.mjs :: SOURCE_BANS`
 * refuses the unit in `.ts` and `.tsx`, and a height in `globals.css` reaches every page.
 */
const SUFFIX = ".css";

/** Its test form, derived from the one suffix walked, so a fixture stylesheet is never read as one the tree ships. */
const PRUEFSUFFIX = `.test${SUFFIX}`;

const sheets = filesUnder(SRC_DIR, (name) => name.endsWith(SUFFIX) && !name.endsWith(PRUEFSUFFIX), 2).map(
  (file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")] as const,
);

/** `100dvh` and `dvh` generally are the answer, so the search is for the unit that is not. */
const BARE_VH = /(?<![a-z-])\d+vh\b|\bvh-screen\b/;

describe("the unit a viewport-sized box may be expressed in", () => {
  /* `vh` is the chrome-HIDDEN height on a phone, so a box sized in it outgrows the visible area and scrolls a
     page that should end at the fold. Nothing in the toolchain sees this: it type-checks, lints, builds, and
     shows up on a device and nowhere else. */
  it("sizes every box in dvh, never vh", () => {
    const offenders = sheets.filter(([, text]) => BARE_VH.test(text)).map(([file]) => file);

    assert.deepEqual(offenders, [], `${offenders.join(", ")} sizes a box in vh, which overshoots the viewport on a phone`);
  });
});
