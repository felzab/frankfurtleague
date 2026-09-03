import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder } from "@/core/treeWalk.ts";

import { textLink } from "./textLink.ts";

// Three levels: this file sits at `src/shared/components/ui`, and the sweep below has to walk all
// of `src` or it reports a clean tree while every feature spells its own links.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/** Every `.tsx` under `src`, which is where a link can be spelled. */
const componentsUnder = (dir: string): string[] => filesUnder(dir, (name) => name.endsWith(".tsx"), 200);

describe("the one treatment a link inside text wears", () => {
  /* Colour alone is not a link to a reader who cannot see it, which is why the underline is in the
     BASE and not a variant a call site can decline. */
  it("underlines in the base, in both tones", () => {
    for (const tone of ["brand", "muted"] as const) {
      assert.match(textLink({ tone: tone }), /(^|\s)underline(\s|$)/, `the ${tone} tone leaves the underline to a hover`);
    }
  });

  /* The two tones say different things — one carries the page's own action, one ranks below a
     primary — so they may not resolve to the same colour. */
  it("keeps the quiet tone distinct from the brand one", () => {
    assert.notEqual(textLink({ tone: "brand" }), textLink({ tone: "muted" }));
    assert.match(textLink({ tone: "brand" }), /text-brand/);
    assert.match(textLink({ tone: "muted" }), /text-foreground-muted/);
  });

  /* Six hand-written spellings of one thing is what this replaced. A seventh reads as a different
     kind of control to anybody scanning the page, and nothing else in the toolchain sees it. */
  it("is the only place a link's underline and colour are spelled", () => {
    const spellings = componentsUnder(SRC)
      .filter((file) => /className="[^"]*(hover:underline|underline-offset)[^"]*"/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

    assert.deepEqual(spellings, [], `these spell a link treatment inline instead of taking \`textLink\`:\n  ${spellings.join("\n  ")}`);
  });
});
