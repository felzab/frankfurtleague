import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

const collectSources = (dir: string): string[] => filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 200);

const sources = new Map(
  collectSources(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

/** One `Hint` element in the tree, with its attributes reachable by name. */
type HintSite = {
  file: string;
  line: number;
  attributes: Map<string, ts.JsxAttributeValue | undefined>;
};

function hintSitesIn(file: string, text: string): HintSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: HintSite[] = [];

  const visit = (node: ts.Node): void => {
    // The element, never its opening tag: matching both would count every `Hint` with children twice.
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;

      if (opening.tagName.getText(source) === "Hint") {
        const attributes = new Map<string, ts.JsxAttributeValue | undefined>();
        for (const attribute of opening.attributes.properties) {
          if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(source), attribute.initializer);
        }
        sites.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, attributes });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return sites;
}

const sites = [...sources].flatMap(([file, text]) => hintSitesIn(file, text));

/** A statically readable string, or `null`. */
function staticText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isJsxExpression(node)) return staticText(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  return null;
}

/**
 * Whether one `aria-describedby` in this file names `token`. A window rather than a parse: the
 * attribute takes a conditional as often as a bare value, and either way the id sits inside it.
 */
function describedByReaches(text: string, token: string): boolean {
  const ATTRIBUTE = "aria-describedby";
  for (let at = text.indexOf(ATTRIBUTE); at !== -1; at = text.indexOf(ATTRIBUTE, at + 1)) {
    if (text.slice(at, at + ATTRIBUTE.length + 200).includes(token)) return true;
  }
  return false;
}

const inlines = sites.filter((site) => staticText(site.attributes.get("mode")) === "inline");

describe("what an inline hint is attached to", () => {
  for (const site of inlines) {
    it(`${site.file}:${String(site.line)} is pointed at by the control it explains`, () => {
      const attribute = site.attributes.get("describes");
      const literal = staticText(attribute);
      const token =
        literal ??
        (attribute !== undefined && ts.isJsxExpression(attribute) && attribute.expression !== undefined
          ? attribute.expression.getText()
          : null);

      assert.ok(token !== null, "an inline hint names the id it publishes");

      assert.ok(
        describedByReaches(sources.get(site.file) ?? "", token),
        `nothing in ${site.file} carries aria-describedby for ${token}, so the hint describes nothing`,
      );
    });
  }
});
