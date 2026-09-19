import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { PILL_TINT } from "./badges.ts";

/* Three levels up from `src/shared/components/ui`: the rule binds every module under `src`, not the
   directory this file happens to sit in. */
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/** Fewer modules than this and a rename has emptied the walk, leaving every case below vacuous. */
const MODULE_FLOOR = 200;

/** Fewer slots than this and the JSX reader has stopped finding them, with the same result. */
const SLOT_FLOOR = 25;

/**
 * Where a fill lands UNDER a pill rather than beside it. A collection option takes `--bg-hover` from
 * `globals.css` under both the pointer and the keyboard; `RailSection`'s fold control paints the
 * same fill across the row its badge slot sits in.
 */
// `RowActionMenuItem` stands beside the library's own: it wraps a `Dropdown.Item` and spells that
// row's hover fill itself, so a pill handed to it sits on the fill as any option's does.
const COLLECTION_OPTIONS = new Set(["ListBox.Item", "Dropdown.Item", "RowActionMenuItem"]);
const BADGE_SLOT = { host: "RailSection", attribute: "badge" };

/** The recipes that read a tone out of `PILL_TINT`, which is the alpha this rule is about. */
const TINTED_CALLS = new Set(["countBadge", "labelBadge"]);

/**
 * A tone whose `PILL_TINT` entry composites, against the fill class that makes it one. Derived from
 * the record rather than listed, so a tone that stops being an alpha stops being flagged in the
 * same edit that changes it.
 */
const COMPOSITE_FILL = new Map(
  Object.entries(PILL_TINT).flatMap(([tone, classes]) => {
    const fill = classes.split(/\s+/).find((token) => /\/\d+$/.test(token));
    return fill === undefined ? [] : [[tone, fill] as const];
  }),
);

/** The same fills keyed the way a class list meets them, which is how a hand-spelled tint is read. */
const TONE_FOR_FILL = new Map([...COMPOSITE_FILL].map(([tone, fill]) => [fill, tone] as const));

const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** Every tinted read inside one node, each as the reason it is one. */
function tintedIn(node: ts.Node, tinted: ReadonlySet<string>): string[] {
  const found: string[] = [];

  // Read off the class list as well as off the recipes: the tint is one string of classes, and
  // spelling it out rather than calling for it paints the same pixels.
  const readClasses = (text: string): void => {
    for (const token of text.split(/\s+/)) {
      const tone = TONE_FOR_FILL.get(token);
      if (tone !== undefined) found.push(`${token} (${tone})`);
    }
  };

  const visit = (inner: ts.Node): void => {
    if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && tinted.has(inner.expression.text)) {
      const [tone] = inner.arguments;
      // An unreadable tone is flagged: nothing here can prove it lands on the one opaque member.
      const named = tone !== undefined && ts.isStringLiteralLike(tone) ? tone.text : null;
      if (named === null || COMPOSITE_FILL.has(named)) found.push(`${inner.expression.text}(${named ?? "…"})`);
    }
    // The same name handed over rather than called, which is what a constant holding a tint is.
    if (ts.isIdentifier(inner) && tinted.has(inner.text) && !(ts.isCallExpression(inner.parent) && inner.parent.expression === inner)) {
      found.push(inner.text);
    }
    if (ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "PILL_TINT") {
      if (COMPOSITE_FILL.has(inner.name.text)) found.push(`PILL_TINT.${inner.name.text}`);
    }
    if (ts.isElementAccessExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "PILL_TINT") {
      found.push("PILL_TINT[…]");
    }
    if (ts.isStringLiteralLike(inner)) readClasses(inner.text);
    if (ts.isTemplateExpression(inner))
      for (const piece of [inner.head, ...inner.templateSpans.map((span) => span.literal)]) readClasses(piece.text);
    ts.forEachChild(inner, visit);
  };
  visit(node);
  return found;
}

/**
 * The recipes, plus every name this module binds to a tint of its own. One hop and no more: a helper
 * two modules away carries no tone a reader of this file can resolve, and review has that pairing.
 */
function tintedNamesIn(source: ts.SourceFile): Set<string> {
  const found = new Set(TINTED_CALLS);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      if (tintedIn(node.initializer, found).length > 0) found.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

type Slot = { file: string; where: string; tinted: string[] };

function slotsIn(file: string, text: string): Slot[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const tinted = tintedNamesIn(source);
  const found: Slot[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && COLLECTION_OPTIONS.has(node.openingElement.tagName.getText(source))) {
      found.push({ file, where: `<${node.openingElement.tagName.getText(source)}>`, tinted: tintedIn(node, tinted) });
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === BADGE_SLOT.host) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== BADGE_SLOT.attribute) continue;
          if (attribute.initializer === undefined) continue;
          found.push({ file, where: `<${BADGE_SLOT.host} ${BADGE_SLOT.attribute}=>`, tinted: tintedIn(attribute.initializer, tinted) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const MODULES = filesUnder(SRC, (name) => name.endsWith(".tsx") && !isTestFile(name), MODULE_FLOOR);
const SLOTS = MODULES.flatMap((file) => slotsIn(relative(file), readFileSync(file, "utf8")));

describe("the population this rule is read over", () => {
  /* No slots and the case below passes over an empty list, which is how a broken JSX reader reports
     a clean tree (`docs/_standard/standard.md :: PRE-4`). */
  it("still finds the slots a fill lands under", () => {
    assert.ok(
      SLOTS.length >= SLOT_FLOOR,
      `expected at least ${String(SLOT_FLOOR)} such slots across ${String(MODULES.length)} modules, found ${String(SLOTS.length)}`,
    );
  });

  /* A host the tree writes nowhere carries the rule to nothing, and reads to the next author as a
     ground already covered. */
  it("meets every host it names", () => {
    const unmet = [...COLLECTION_OPTIONS, BADGE_SLOT.host].filter((host) => !SLOTS.some((slot) => slot.where.startsWith(`<${host}`)));

    assert.deepEqual(unmet, [], `a named host stands in no module, so this rule reaches nothing through it:\n  ${unmet.join("\n  ")}`);
  });

  /* Every tone opaque and the case below is true by construction, which is how a retinted palette
     turns this file green and silent. */
  it("still reads `PILL_TINT` as a record of alphas", () => {
    assert.notEqual(COMPOSITE_FILL.size, 0, "no `PILL_TINT` tone reads as an alpha any more, so nothing below can be flagged");
  });
});

describe("what a pill may be painted on", () => {
  it("takes a solid fill wherever a hover fill lands under it", () => {
    const wrong = SLOTS.filter((slot) => slot.tinted.length > 0).map((slot) => `${slot.file}  ${slot.where}  ${slot.tinted.join(", ")}`);

    assert.deepEqual(
      wrong,
      [],
      "a tint composites against the fill under it and misses 4.5:1. Take the tone's opaque twin -- `trackCountBadge`," +
        ` \`trackLabelBadge\`, \`PILL_SOLID\`, or the \`brandSolid\` tone. A phase tone has no twin, so its pill moves off this ground:\n  ${wrong.join("\n  ")}`,
    );
  });
});
