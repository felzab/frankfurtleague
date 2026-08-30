import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const UI_DIR = import.meta.dirname;
const SRC_DIR = path.resolve(UI_DIR, "..", "..", "..");

/**
 * Every box in the app sized against the viewport. Three, and they have to agree: the expression is
 * copied from one to the next, so the unit one of them gets wrong is the unit the next one inherits.
 */
const VIEWPORT_BOXES = [
  ["PageLoader", path.join(UI_DIR, "PageLoader.tsx")],
  ["ContentLoader", path.join(UI_DIR, "ContentLoader.tsx")],
  ["SignInForm", path.join(SRC_DIR, "features", "auth", "components", "forms", "SignInForm.tsx")],
] as const;

describe("the unit a viewport-sized box may be expressed in", () => {
  /* `vh` is the chrome-HIDDEN height on a phone, so a box sized in it outgrows the visible area and
     scrolls a page that should end at the fold. Nothing in the toolchain sees this: it type-checks,
     lints, builds, and shows up on a device and nowhere else. */
  for (const [name, file] of VIEWPORT_BOXES) {
    it(`${name} sizes itself in dvh, never vh`, () => {
      const source = readFileSync(file, "utf8");
      assert.ok(!source.includes("100vh"), `${name} is back on vh, which overshoots the viewport on a phone`);
    });
  }
});
