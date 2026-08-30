import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * Discovered rather than listed: a named handful is the boxes somebody remembered. Stylesheets are read too — a
 * height in `globals.css` reaches every page and no component file mentions it.
 */
function collectSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSources(full);

    return /\.(tsx?|css)$/.test(entry.name) ? [full] : [];
  });
}

/** `100dvh` and `dvh` generally are the answer, so the search is for the unit that is not. */
const BARE_VH = /(?<![a-z-])\d+vh\b|\bvh-screen\b/;

const sources = collectSources(SRC_DIR).map(
  (file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")] as const,
);

describe("the unit a viewport-sized box may be expressed in", () => {
  it("reads the whole tree, so a new box is swept without being remembered", () => {
    // Anti-vacuity: a changed extension filter or a moved root would leave the case below true of nothing.
    assert.ok(sources.length >= 200, `expected at least 200 sources, found ${String(sources.length)}`);
    assert.ok(
      sources.some(([file]) => file.endsWith(".css")),
      "no stylesheet is being read, where a height reaches every page",
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
