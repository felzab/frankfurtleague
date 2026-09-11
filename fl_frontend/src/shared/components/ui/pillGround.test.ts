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
const COLLECTION_OPTIONS = new Set(["ListBox.Item", "Menu.Item", "Dropdown.Item"]);
const BADGE_SLOT = { host: "RailSection", attribute: "badge" };

/** The recipes that read a tone out of `PILL_TINT`, which is the alpha this rule is about. */
const TINTED_CALLS = new Set(["countBadge", "labelBadge"]);

/**
 * A tone whose `PILL_TINT` entry composites. Derived from the record rather than listed, so a tone
 * that stops being an alpha stops being flagged in the same edit that changes it.
 */
const COMPOSITES = new Set(Object.entries(PILL_TINT).flatMap(([tone, classes]) => (/\/\d+(?:\s|$)/.test(classes) ? [tone] : [])));

const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** Every tinted read inside one node, each as the reason it is one. */
function tintedIn(node: ts.Node): string[] {
  const found: string[] = [];
  const visit = (inner: ts.Node): void => {
    if (ts.isCallExpression(inner) && ts.isIdentifier(inner.expression) && TINTED_CALLS.has(inner.expression.text)) {
      const [tone] = inner.arguments;
      // An unreadable tone is flagged: nothing here can prove it lands on the one opaque member.
      const named = tone !== undefined && ts.isStringLiteralLike(tone) ? tone.text : null;
      if (named === null || COMPOSITES.has(named)) found.push(`${inner.expression.text}(${named ?? "…"})`);
    }
    if (ts.isPropertyAccessExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "PILL_TINT") {
      if (COMPOSITES.has(inner.name.text)) found.push(`PILL_TINT.${inner.name.text}`);
    }
    if (ts.isElementAccessExpression(inner) && ts.isIdentifier(inner.expression) && inner.expression.text === "PILL_TINT") {
      found.push("PILL_TINT[…]");
    }
    ts.forEachChild(inner, visit);
  };
  visit(node);
  return found;
}

type Slot = { file: string; where: string; tinted: string[] };

function slotsIn(file: string, text: string): Slot[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Slot[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && COLLECTION_OPTIONS.has(node.openingElement.tagName.getText(source))) {
      found.push({ file, where: `<${node.openingElement.tagName.getText(source)}>`, tinted: tintedIn(node) });
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === BADGE_SLOT.host) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== BADGE_SLOT.attribute) continue;
          if (attribute.initializer === undefined) continue;
          found.push({ file, where: `<${BADGE_SLOT.host} ${BADGE_SLOT.attribute}=>`, tinted: tintedIn(attribute.initializer) });
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

  /* Every tone opaque and the case below is true by construction, which is how a retinted palette
     turns this file green and silent. */
  it("still reads `PILL_TINT` as a record of alphas", () => {
    assert.notEqual(COMPOSITES.size, 0, "no `PILL_TINT` tone reads as an alpha any more, so nothing below can be flagged");
  });
});

describe("what a pill may be painted on", () => {
  it("takes a solid fill wherever a hover fill lands under it", () => {
    const wrong = SLOTS.filter((slot) => slot.tinted.length > 0).map((slot) => `${slot.file}  ${slot.where}  ${slot.tinted.join(", ")}`);

    assert.deepEqual(
      wrong,
      [],
      `a tint composites against the hover fill under it and misses 4.5:1 -- use \`trackCountBadge\`, \`trackLabelBadge\` or \`PILL_SOLID\`:\n  ${wrong.join("\n  ")}`,
    );
  });
});
