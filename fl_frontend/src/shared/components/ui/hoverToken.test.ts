import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { classTokensIn } from "@/shared/testing/classTokens.ts";

// Three levels up from `src/shared/components/ui`: the rule binds every module under `src`, not the
// directory this file happens to sit in.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/** Fewer modules than this and a rename has emptied the walk, leaving every case below vacuous. */
const MODULE_FLOOR = 350;

/** Fewer hovers than this and the tokeniser has stopped reading class strings, with the same result. */
const HOVER_FLOOR = 50;

/** Every hover-family variant, which is what the floor above is counted over. */
const ANY_HOVER = /(?:^|:)(?:hover|group-hover|peer-hover|data-hovered):/;

/** A hover that fades the element, so what it reads as is decided by whatever sits behind it. */
const HOVER_OPACITY = /(?:^|:)(?:hover|group-hover|peer-hover|data-hovered):opacity-/;

const COLOUR_UTILITIES = "bg|text|border|ring|outline|shadow|fill|stroke|decoration|divide|accent|from|via|to";

/** The same fault one utility further in: a colour at an alpha composites rather than painting. */
const HOVER_ALPHA = new RegExp(
  `(?:^|:)(?:hover|group-hover|peer-hover|data-hovered):(?:${COLOUR_UTILITIES})-[^\\s/]+/(?:\\d{1,3}|\\[[^\\]\\s/]+\\])$`,
);

const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/**
 * Both suffixes: a recipe module spelling one hover for many call sites spreads the fault rather than
 * escaping it, so `docs/frontend/spec.md :: I162` reaches it.
 */
const swept = filesUnder(SRC, (name) => /\.tsx?$/.test(name) && !isTestFile(name), MODULE_FLOOR).map((file) => ({
  file: relative(file),
  tokens: classTokensIn(relative(file), readFileSync(file, "utf8")),
}));

/** Where one pattern is spelled, named by file so the message points at the file to change. */
const offenders = (pattern: RegExp): string[] =>
  swept.flatMap(({ file, tokens }) => tokens.filter((token) => pattern.test(token)).map((token) => `${file}  ${token}`));

describe("what a hover is allowed to be spelled as", () => {
  it("still reads the hovers the tree already spells", () => {
    const found = offenders(ANY_HOVER).length;

    assert.ok(
      found >= HOVER_FLOOR,
      `expected at least ${String(HOVER_FLOOR)} hover variants across ${String(swept.length)} modules, found ${String(found)}`,
    );
  });

  /* An opacity fades the element against its ground, and the ground is a different colour in each
     theme, so one spelling lands as two colours and neither is the step the tokens declare. */
  it("takes no hover spelled as an opacity", () => {
    const found = offenders(HOVER_OPACITY);

    assert.deepEqual(
      found,
      [],
      `a hover is one of \`fl_frontend/src/app/globals.css\`'s hover tokens, never an opacity:\n  ${found.join("\n  ")}`,
    );
  });

  it("takes no hover spelled as a colour at an alpha", () => {
    const found = offenders(HOVER_ALPHA);

    assert.deepEqual(found, [], `a hover is a declared token, never a tint of one:\n  ${found.join("\n  ")}`);
  });
});
