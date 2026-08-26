import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/** The cap is a lead and four bullets, together about this many characters. */
const HINT_CHAR_CAP = 350;
const HINT_POINT_CAP = 4;

/**
 * German abbreviations whose period ends no sentence. Listed rather than pattern-matched: every
 * pattern that reads a lone period as an abbreviation also reads the end of a sentence as one.
 */
const ABBREVIATIONS = ["z.B.", "ca.", "bzw.", "u.a.", "etc.", "ggf.", "evtl.", "inkl.", "max.", "min.", "Nr.", "Std.", "Mio.", "Mrd."];

function collectSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSources(full);
    if (/\.test\.tsx?$/.test(entry.name)) return [];

    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const sources = new Map(
  collectSources(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

/** One `<Hint …>` in the tree, with its attributes reachable by name. */
type HintSite = { file: string; line: number; attributes: Map<string, ts.JsxAttributeValue | undefined> };

function hintSitesIn(file: string, text: string): HintSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: HintSite[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      if (node.tagName.getText(source) === "Hint") {
        const attributes = new Map<string, ts.JsxAttributeValue | undefined>();
        for (const attribute of node.attributes.properties) {
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

/**
 * A statically readable string, or `null`. An interpolated one is `null` rather than approximated:
 * a value the sweep cannot count is a value the cap does not bind.
 */
function staticText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isJsxExpression(node)) return staticText(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  return null;
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) return property.initializer;
  }
  return undefined;
}

const bodyOf = (site: HintSite): ts.ObjectLiteralExpression | null => {
  const attribute = site.attributes.get("body");
  if (attribute === undefined || !ts.isJsxExpression(attribute)) return null;
  const expression = attribute.expression;

  return expression !== undefined && ts.isObjectLiteralExpression(expression) ? expression : null;
};

/** The bullets a `body` writes, each already joined into the one sentence it renders as. */
function pointsOf(body: ts.ObjectLiteralExpression): { readable: string[]; unreadable: number } {
  const points = propertyOf(body, "points");
  if (points === undefined) return { readable: [], unreadable: 0 };
  if (!ts.isArrayLiteralExpression(points)) return { readable: [], unreadable: 1 };

  const readable: string[] = [];
  let unreadable = 0;
  for (const element of points.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      unreadable += 1;
      continue;
    }
    const term = propertyOf(element, "term");
    const text = staticText(propertyOf(element, "text"));
    const termText = term === undefined ? "" : staticText(term);

    if (text === null || termText === null) unreadable += 1;
    else readable.push(termText === "" ? text : `${termText} ${text}`);
  }

  return { readable, unreadable };
}

/** Sentence-ending punctuation that is not an abbreviation's and not the string's own last mark. */
function sentenceBreaks(sentence: string): number {
  let stripped = sentence;
  for (const abbreviation of ABBREVIATIONS) stripped = stripped.split(abbreviation).join("");

  return (stripped.replace(/[.!?]\s*$/, "").match(/[.!?]/g) ?? []).length;
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

const reveals = sites.filter((site) => staticText(site.attributes.get("mode")) === "reveal");
const inlines = sites.filter((site) => staticText(site.attributes.get("mode")) === "inline");

describe("what a hint is allowed to say", () => {
  it("found hints to measure at all", () => {
    // A floor, not a count: a rename that silently matched nothing would leave every case below
    // vacuously true.
    assert.ok(sources.size >= 100, `expected at least 100 components to sweep, found ${String(sources.size)}`);
    assert.ok(reveals.length >= 3, `expected at least 3 revealed hints, found ${String(reveals.length)}`);
  });

  for (const site of reveals) {
    it(`${site.file}:${String(site.line)} keeps the lead-and-four-bullets cap`, () => {
      const body = bodyOf(site);
      assert.ok(body !== null, "a revealed hint writes its body as an object literal, so the cap can be counted");

      const lead = staticText(propertyOf(body, "lead"));
      assert.ok(lead !== null, "the lead is a plain string, so the cap can be counted");

      const { readable, unreadable } = pointsOf(body);
      assert.equal(unreadable, 0, `${String(unreadable)} bullet(s) are not plain strings, so the cap cannot be counted`);
      assert.ok(readable.length <= HINT_POINT_CAP, `${String(readable.length)} bullets — the cap is ${String(HINT_POINT_CAP)}`);

      const written = [lead, ...readable];
      const length = written.reduce((sum, sentence) => sum + sentence.length, 0);
      assert.ok(length <= HINT_CHAR_CAP, `${String(length)} characters — the cap is ${String(HINT_CHAR_CAP)}. Say less, or move it.`);

      for (const sentence of written) {
        assert.equal(sentenceBreaks(sentence), 0, `two sentences where one was allowed: "${sentence}"`);
      }
    });
  }

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
