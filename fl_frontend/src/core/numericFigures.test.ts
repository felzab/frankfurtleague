import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC = path.resolve(import.meta.dirname, "..");

/**
 * The pair, never one alone: `tabular-nums` asks the current face for tabular figures, and the page
 * face has none (`fl_frontend/src/app/globals.css :: --font-numeric`).
 */
const PAIR = ["font-numeric", "tabular-nums"] as const;

/* Test files are OUT: this file's own sample below is a class list spelling one utility alone, and a
   sweep reading it would grade its own fixture as production text. */
const isProduction = (name: string): boolean => (name.endsWith(".ts") || name.endsWith(".tsx")) && !isTestFile(name);

/**
 * Parsed rather than matched as text: `font-numeric` is named in prose at the font declaration, and
 * a reader counting raw occurrences grades that comment as a class list.
 */
function writtenStrings(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];

  const visit = (node: ts.Node): void => {
    // A template's chunks join into ONE list: a pair parted by a `${…}` hole is still a pair.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found.push(node.text);
    else if (ts.isTemplateExpression(node)) found.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "));

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Whole tokens, so the Schulform `oberstufengymnasium` cannot answer for a utility it merely contains. */
const holds = (written: string, token: string): boolean => new RegExp(`(^|\\s)${token}(\\s|$)`).test(written);

const unpaired = (written: readonly string[]): string[] => written.filter((one) => holds(one, PAIR[0]) !== holds(one, PAIR[1]));

/** One class list spelling each utility alone, and two spelling the pair. */
const SAMPLE = {
  lonely: `<span className="fluid-xs tabular-nums">{n}</span>`,
  faceOnly: `<span className="font-numeric fluid-xs">{n}</span>`,
  paired: `<span className="font-numeric fluid-xs tabular-nums">{n}</span>`,
  partedByAHole: "<span className={`font-numeric ${tint} tabular-nums`}>{n}</span>",
};

describe("the two utilities a fixed-width numeric readout wears", () => {
  /* The tree is uniform, so a reader stopping at the first pairing it finds passes over the very
     violation this sweep exists for (`docs/frontend/spec.md :: 1.9 The test suite`). */
  it("reports either utility written alone, and clears a pair parted by a template hole", () => {
    const read = (source: string): string[] => unpaired(writtenStrings("sample.tsx", source));

    assert.equal(read(SAMPLE.lonely).length, 1, "reads a lone `tabular-nums` as paired");
    assert.equal(read(SAMPLE.faceOnly).length, 1, "reads a lone `font-numeric` as paired");
    assert.deepEqual(read(SAMPLE.paired), [], "reads a spelled pair as unpaired");
    assert.deepEqual(read(SAMPLE.partedByAHole), [], "reads a pair either side of a `${…}` hole as unpaired");
  });

  /* A lone `tabular-nums` paints proportional digits into a column width measured against fixed
     ones, and compiles, lints and renders without reporting it. */
  it("pairs them in every class list the tree writes", () => {
    const findings = filesUnder(SRC, isProduction, 400).flatMap((file) => {
      const lonely = unpaired(writtenStrings(file, readFileSync(file, "utf8")));

      return lonely.map((one) => `${path.relative(SRC, file).split(path.sep).join("/")}: ${one.trim()}`);
    });

    assert.deepEqual(findings, [], `these spell one of the pair without the other:\n  ${findings.join("\n  ")}`);
  });
});
