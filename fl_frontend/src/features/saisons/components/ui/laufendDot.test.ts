import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { laufendDot } from "./laufendDot.ts";

import type { LaufendDotStep } from "./laufendDot.ts";

// Four levels up: this file sits at `src/features/saisons/components/ui`, and a sweep rooted inside
// the slice reports a clean tree while another slice paints its own live dot.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..", "..");

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** The module holding the grade, which the sweep for a copy has to stand outside. */
const RECIPE = path.join(SRC, "features", "saisons", "components", "ui", "laufendDot.ts");

/**
 * Spelled out rather than read off the recipe, which is what the cases below grade: a list derived
 * from it would grade a third step by nothing and a retired one not at all.
 */
const STEPS: readonly LaufendDotStep[] = ["xxs", "xs"];

/* Matched as whole tokens: `bg-brand/20` is the page loader's halo and `bg-brand-solid` is a fill,
   and a substring reader grades both as this dot. */
const GRADE = ["bg-brand", "animate-ping"];

const carriesTheGrade = (written: string): boolean => {
  const tokens = written.split(/\s+/);
  return GRADE.every((token) => tokens.includes(token));
};

const isProduction = (name: string): boolean => (name.endsWith(".ts") || name.endsWith(".tsx")) && !isTestFile(name);

/**
 * Parsed rather than matched as text: the grade is named in prose wherever the choice of `bg-brand`
 * is argued, and a reader counting raw occurrences grades that comment as a class list.
 */
function spellsTheDot(file: string, text: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = false;

  const visit = (node: ts.Node): void => {
    // A template's chunks join into ONE list: a grade parted by a `${…}` hole is still the grade.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) found ||= carriesTheGrade(node.text);
    else if (ts.isTemplateExpression(node))
      found ||= carriesTheGrade([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "));

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** The dot as a copy would carry it, two shapes that wear brand without being it, and the grade named in prose. */
const SAMPLE = {
  inAClassList: 'const c = <span className="bg-brand size-2 animate-ping rounded-full" />;',
  acrossATemplateHole: "const c = <span className={`bg-brand ${size} animate-ping rounded-full`} />;",
  theLoadersHalo: 'const c = <div className="bg-brand/20 absolute size-16 animate-ping rounded-full" />;',
  aSolidFill: 'const c = <span className="bg-brand-solid size-2 animate-ping rounded-full" />;',
  namedInAComment: "// `bg-brand` and never the solid fill, under `animate-ping`.\nconst c = SOMETHING;",
};

describe("the mark a running season wears on both surfaces", () => {
  /* A step that dropped the grade would paint an unanimated dot in whatever colour it inherited,
     which renders and reports nothing. */
  it("carries the grade and its own size into every step it composes", () => {
    for (const step of STEPS) {
      const tokens = laufendDot(step).split(" ");

      assert.ok(carriesTheGrade(laufendDot(step)), `\`${step}\` composes to ${laufendDot(step)}, which drops the grade`);
      assert.ok(
        tokens.some((token) => token.startsWith("size-")),
        `\`${step}\` composes to ${laufendDot(step)}, which paints a dot with no size`,
      );
    }
  });

  /* Two sizes for two type steps, so an ornament never outweighs the word beside it; one size for
     both would be a parameter nothing reads. */
  it("gives the two steps different sizes", () => {
    assert.notEqual(laufendDot("xxs"), laufendDot("xs"), "both steps compose the same dot");
  });

  /* The tree is uniform, so a reader stopping at the first thing it finds passes over the violation
     this sweep exists for (`docs/frontend/spec.md :: 1.9 The test suite`). */
  it("reads the dot out of a class list and a template, and grades neither a brand neighbour nor a comment", () => {
    const reads = (source: string): boolean => spellsTheDot("sample.tsx", source);

    assert.ok(reads(SAMPLE.inAClassList), "the dot in a class list reads as absent");
    assert.ok(reads(SAMPLE.acrossATemplateHole), "the dot parted by a template hole reads as absent");
    assert.ok(!reads(SAMPLE.theLoadersHalo), "the page loader's halo reads as this dot");
    assert.ok(!reads(SAMPLE.aSolidFill), "a solid brand fill reads as this dot");
    assert.ok(!reads(SAMPLE.namedInAComment), "the grade named in a comment reads as a class list");
  });

  /* Two copies of the grade drift one token at a time, and the copy that took the solid fill renders
     fine in whichever theme its author had open. */
  it("is the only place the dot is spelled", () => {
    // An exemption outliving the copy it was written for spares whatever is written in that file next.
    assert.ok(spellsTheDot(RECIPE, readFileSync(RECIPE, "utf8")), `${rel(RECIPE)}: spells no live dot`);

    const spellings = filesUnder(SRC, isProduction, 400)
      .filter((file) => file !== RECIPE && spellsTheDot(file, readFileSync(file, "utf8")))
      .map(rel);

    assert.deepEqual(spellings, [], `these spell the live dot inline instead of taking \`laufendDot\`:\n  ${spellings.join("\n  ")}`);
  });
});
