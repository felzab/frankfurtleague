import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

// Three levels up from `src/shared/components/ui`: the rule binds every call site under `src`, not
// the recipes that happen to sit beside this file.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/** Fewer components than this and a rename has emptied the walk, leaving every case below vacuous. */
const COMPONENT_FLOOR = 200;

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

/**
 * Every whitespace-separated run inside a string or template literal. A literal rather than the raw
 * text, so a comment naming one of these spellings — this file's own included — cannot fail the sweep.
 */
function classTokensIn(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tokens: string[] = [];

  const push = (literal: string): void => {
    for (const token of literal.split(/\s+/)) if (token !== "") tokens.push(token);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) push(node.text);
    else if (ts.isTemplateExpression(node)) {
      push(node.head.text);
      for (const span of node.templateSpans) push(span.literal.text);
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return tokens;
}

const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/**
 * `.tsx` alone, which is where `docs/frontend/spec.md :: I162` puts the rule. Whether a recipe module
 * spelling one hover for many call sites answers to it is an open question a sweep cannot settle.
 */
const swept = filesUnder(SRC, (name) => name.endsWith(".tsx") && !isTestFile(name), COMPONENT_FLOOR).map((file) => ({
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
      `expected at least ${String(HOVER_FLOOR)} hover variants across ${String(swept.length)} components, found ${String(found)}`,
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
