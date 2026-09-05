import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { labelBadge, PILL_TINT } from "./badges.ts";

import type { PillTone } from "./badges.ts";

// Three levels up: this file sits at `src/shared/components/ui`, and a sweep rooted any lower reports
// a clean tree while a feature paints its own chips.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/** The pair the ruling refuses, spelled once. */
const NEUTRAL = "bg-muted text-foreground-muted";

/**
 * Spelled out rather than read off the record, so a tone gaining a pair and a tone losing one are
 * both a failure here rather than a shorter run.
 */
const TONES: readonly PillTone[] = [
  "success",
  "warning",
  "danger",
  "info",
  "brand",
  "brandSolid",
  "gruppenphase",
  "achtelfinale",
  "viertelfinale",
  "halbfinale",
  "finale",
];

/* Test files are OUT: this file's own sample below spells the refused pair beside a `PILL_RADIUS`
   import, and a sweep reading it would grade its own fixture as production text. */
const isProduction = (name: string): boolean => (name.endsWith(".ts") || name.endsWith(".tsx")) && !isTestFile(name);

/** A `PILL_RADIUS` binding, whichever specifier reaches this module — the app writes it two ways. */
function composesAPill(node: ts.ImportDeclaration): boolean {
  if (!ts.isStringLiteral(node.moduleSpecifier) || !/badges(\.ts)?$/.test(node.moduleSpecifier.text)) return false;

  const bindings = node.importClause?.namedBindings;
  return bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.some((element) => element.name.text === "PILL_RADIUS");
}

/**
 * Parsed rather than matched as text: the pair is named in prose wherever the refusal is argued, and
 * a reader counting raw occurrences grades that comment as a class list.
 */
function readModule(file: string, text: string): { pill: boolean; written: string[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let pill = false;
  const written: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && composesAPill(node)) pill = true;

    // A template's chunks join into ONE list: a pair parted by a `${…}` hole is still a pair.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) written.push(node.text);
    else if (ts.isTemplateExpression(node)) written.push([node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" "));

    ts.forEachChild(node, visit);
  };
  visit(source);

  return { pill, written };
}

const paintsNeutral = (reading: { pill: boolean; written: readonly string[] }): boolean =>
  reading.pill && reading.written.some((one) => one.includes(NEUTRAL));

/** A pill painted neutral two ways, a pill painted from the set, and two shapes that are not this sweep's. */
const SAMPLE = {
  inAToneMap: 'import { PILL_RADIUS } from "@/shared/components/ui/badges";\nconst T = { unbekannt: "bg-muted text-foreground-muted" };',
  inAClassList: 'import { PILL_RADIUS } from "./badges";\nconst c = <span className={`${PILL_RADIUS} bg-muted text-foreground-muted`} />;',
  fromTheSet: 'import { PILL_RADIUS } from "@/shared/components/ui/badges";\nconst T = { heute: "bg-info/15 text-info-strong" };',
  aColumnHeader: 'const H = <th className="bg-muted text-foreground-muted px-6 py-4" />;',
  namedInAComment: 'import { PILL_RADIUS } from "./badges";\n// Never `bg-muted text-foreground-muted`.\nconst c = PILL_RADIUS;',
};

describe("the closed set every pill takes its colour from", () => {
  /* A tone with no fill or no ink paints half a chip, which renders and reports nothing; the neutral
     pair readmitted under a tone name is the ruling undone in one line. */
  it("gives every tone a fill and an ink, and none of them the refused pair", () => {
    assert.deepEqual([...TONES].sort(), Object.keys(PILL_TINT).sort(), "the set and this case's list no longer name the same tones");

    for (const tone of TONES) {
      const tokens = PILL_TINT[tone].split(/\s+/);

      assert.ok(
        tokens.some((token) => token.startsWith("bg-")) && tokens.some((token) => token.startsWith("text-")),
        `\`${tone}\` is ${PILL_TINT[tone]}, which paints no chip`,
      );
      assert.ok(!tokens.includes("bg-muted") && !tokens.includes("text-foreground-muted"), `\`${tone}\` is the refused pair under a name`);
    }
  });

  /* The shape a caller composes is the shape plus the tone, so a pill cannot exist with the tone
     left off. */
  it("carries the tone's own pair into the pill it composes", () => {
    for (const tone of TONES) {
      assert.ok(labelBadge(tone).endsWith(PILL_TINT[tone]), `\`${tone}\` composes to ${labelBadge(tone)}, which drops its own pair`);
    }
  });

  /* The tree is uniform, so a reader stopping at the first thing it finds passes over the violation
     this sweep exists for (`docs/frontend/spec.md :: 1.9 The test suite`). */
  it("reads a neutral pair out of a tone map and a class list, and grades neither a header nor a comment", () => {
    const reads = (source: string): boolean => paintsNeutral(readModule("sample.tsx", source));

    assert.ok(reads(SAMPLE.inAToneMap), "a neutral pair in a tone map reads as toned");
    assert.ok(reads(SAMPLE.inAClassList), "a neutral pair in a class list reads as toned");
    assert.ok(!reads(SAMPLE.fromTheSet), "a pair out of the set reads as neutral");
    assert.ok(!reads(SAMPLE.aColumnHeader), "a table header composing no pill is graded as one");
    assert.ok(!reads(SAMPLE.namedInAComment), "the pair named in a comment is graded as a class list");
  });

  /* One vocabulary across files, which is what no single render shows: a chip reads correctly on its
     own page and still spells a pair the set does not carry. */
  it("leaves no neutral pair in a module that composes a pill", () => {
    const composing = filesUnder(SRC, isProduction, 400)
      .map((file) => ({ file, ...readModule(file, readFileSync(file, "utf8")) }))
      .filter((reading) => reading.pill);

    // Floored on its own: the sweep answers the same clean answer over a tree nothing imports the
    // radius from, which is what a rename of that export would leave behind.
    assert.ok(composing.length >= 4, `${String(composing.length)} modules compose a pill, so this sweep is reading almost nothing`);

    const findings = composing.filter(paintsNeutral).map((reading) => path.relative(SRC, reading.file).split(path.sep).join("/"));

    assert.deepEqual(findings, [], `these paint a chip neutral instead of naming a \`PillTone\`:\n  ${findings.join("\n  ")}`);
  });
});
