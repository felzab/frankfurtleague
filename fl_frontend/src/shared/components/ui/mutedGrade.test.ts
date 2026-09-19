import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

// Three levels up: this file sits at `src/shared/components/ui`, and a sweep walking anything
// narrower reports a clean tree while every feature spells the recipe out.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

const STYLESHEET = path.join(SRC, "app", "globals.css");

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** The two muted text grades, which are the recipes a hand-spelling of this shape reproduces. */
const GRADES = ["muted-hint", "muted-meta"];

/**
 * What a utility `@apply`s, read from the stylesheet rather than mirrored here: a copy of the token
 * list would keep passing a branch that changed one of the two.
 */
function expansionOf(stylesheet: string, utility: string): string[] {
  const declared = new RegExp(String.raw`@utility\s+${utility}\s*\{\s*@apply\s+([^;}]+);`).exec(stylesheet);

  return declared === null ? [] : declared[1]!.split(/\s+/).filter((token) => token !== "");
}

/**
 * Per list and never per module: a dozen files carry one grade's tokens across separate attributes,
 * and a reader joining them reports every one of those as a hand-spelling.
 */
function classListsIn(file: string, text: string): string[][] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lists: string[][] = [];

  const push = (literal: string): void => {
    const tokens = literal.split(/\s+/).filter((token) => token !== "");
    if (tokens.length > 0) lists.push(tokens);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) push(node.text);

    // The static halves alone, so a list assembled around an interpolated constant is invisible here.
    if (ts.isTemplateExpression(node)) push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "));

    ts.forEachChild(node, visit);
  };

  visit(source);

  return lists;
}

/**
 * The carve-out is the rule rather than a name: `fluid-*` sets a line-height with its size, so a
 * list overriding that one is knowingly not the utility, for the reason
 * `fl_frontend/src/core/providers/AppToaster.tsx` gives where it does exactly that.
 */
const spellsOut = (list: string[], expansion: string[]): boolean =>
  expansion.every((token) => list.includes(token)) && !list.some((token) => token.startsWith("leading-"));

const modulesUnder = (dir: string): string[] => filesUnder(dir, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 500);

const STYLES = readFileSync(STYLESHEET, "utf8");
const MODULES = modulesUnder(SRC).map((file) => ({ file: rel(file), lists: classListsIn(rel(file), readFileSync(file, "utf8")) }));

describe("the two muted text grades", () => {
  /* A rename in the stylesheet empties every expansion below, and a sweep comparing against an empty
     set passes every file in the tree. */
  it("are declared where this reads them, each with tokens to compare", () => {
    for (const grade of GRADES) {
      assert.ok(expansionOf(STYLES, grade).length > 0, `${rel(STYLESHEET)} declares no \`@utility ${grade}\` this reader can expand`);
    }
  });

  /* The population the sweep judges. A walk that matched nothing would report a clean tree, and a
     tree where nobody takes the utility by name is one the rule below has stopped describing. */
  it("are taken by name somewhere in the tree", () => {
    for (const grade of GRADES) {
      const takers = MODULES.filter((module) => module.lists.some((list) => list.includes(grade)));

      assert.ok(takers.length > 0, `nothing under ${rel(SRC)} wears \`${grade}\`, so no call site holds the recipe`);
    }
  });

  /* Three classes retyped render exactly as the utility does, so the drift is legible in the source
     alone — and the grade then moves at one site while the rest of the screen keeps the old one. */
  for (const grade of GRADES) {
    it(`are spelled once each, and \`${grade}\` is not retyped at a call site`, () => {
      const expansion = expansionOf(STYLES, grade);
      const spellings = MODULES.filter((module) => module.lists.some((list) => spellsOut(list, expansion))).map((module) => module.file);

      assert.deepEqual(spellings, [], `these spell \`${grade}\` out instead of wearing it:\n  ${spellings.join("\n  ")}`);
    });
  }
});
