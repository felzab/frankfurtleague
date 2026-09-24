import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * The controls that JUDGE a date; `aria` folds their bounds into the displayed validation in realtime. This file
 * grades WHERE a bound sits, never that a refusal carries German — `features/spieltage/schemas.test.ts` does that.
 */
const JUDGING = new Set(["DatePicker", "DateField", "TimeField"]);

/** Every control that draws segments, whose digits the locale pads unless the composition forces two. */
const SEGMENTED = new Set([...JUDGING, "DateRangePicker"]);

/** The one that OFFERS dates. A bound here greys days out and reports nothing. */
const OFFERING = "Calendar";

const BOUNDS = ["minValue", "maxValue", "isDateUnavailable"];

/** Tests are left out because this file is one: the sweep would otherwise read its own literals. */
const collectSources = (dir: string): string[] => filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 200);

const sources = new Map(
  collectSources(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

type Site = { file: string; tag: string; bounds: string[] };

/** `minValue={undefined}` is an attribute with no bound in it: present to a name check, absent to the user. */
function carriesAValue(attribute: ts.JsxAttribute, source: ts.SourceFile): boolean {
  const initializer = attribute.initializer;
  if (initializer === undefined) return false;
  if (!ts.isJsxExpression(initializer)) return true;

  const expression = initializer.expression;
  return expression !== undefined && expression.getText(source) !== "undefined";
}

/**
 * HeroUI's imports alone. `Calendar` is also a gravity-ui ICON, and an icon carries no bounds and offers no days —
 * counted as the control it would make the sweep report a component that renders neither.
 */
function heroUiNames(source: ts.SourceFile): Map<string, string> {
  const names = new Map<string, string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!/^@heroui\/react(\/|$)/.test(statement.moduleSpecifier.text)) continue;

    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;

    // A namespace import binds every name behind one identifier, so nothing here can tell which tag is
    // HeroUI's. Refuse to answer rather than answer wrongly.
    if (ts.isNamespaceImport(bindings)) throw new Error(`${source.fileName} imports HeroUI as a namespace, which this sweep cannot resolve`);
    if (!ts.isNamedImports(bindings)) continue;

    // Keyed on the LOCAL name, which is what the JSX writes, and valued with the imported one: `DatePicker as Picker`
    // renders a date picker under a tag no name check would recognise.
    for (const element of bindings.elements) names.set(element.name.getText(source), (element.propertyName ?? element.name).getText(source));
  }

  return names;
}

/**
 * Read from the AST rather than by text: a bound reaches a control as a JSX ATTRIBUTE, and a source scan cannot
 * tell one on the picker from one on the calendar nested three elements inside it.
 */
function sitesIn(file: string, text: string): Site[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fromHeroUi = heroUiNames(source);
  const sites: Site[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = fromHeroUi.get(opening.tagName.getText(source));

      if (tag !== undefined && (SEGMENTED.has(tag) || tag === OFFERING)) {
        const bounds: string[] = [];

        for (const attribute of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) continue;
          const spelt = attribute.name.getText(source);
          if (BOUNDS.includes(spelt) && carriesAValue(attribute, source)) bounds.push(spelt);
        }

        sites.push({ file, tag, bounds });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return sites;
}

const sites = [...sources].flatMap(([file, text]) => sitesIn(file, text));

/**
 * Whether the file declares `bound` as a PROP of one of its own components — a binding it must forward — rather
 * than merely mentioning the word. Read from the AST, so a NumberField's `minValue` argument cannot pose as one.
 */
function declaresProp(file: string, text: string, bound: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let declares = false;

  const visit = (node: ts.Node): void => {
    if (ts.isTypeLiteralNode(node)) {
      for (const member of node.members) {
        if (ts.isPropertySignature(member) && member.name.getText(source) === bound) declares = true;
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return declares;
}

describe("where a date control's bounds live", () => {
  it("finds the date controls it is meant to sweep", () => {
    // The anti-vacuity clause, per kind rather than as a count: every field composes in one file, so a
    // tag rename would otherwise leave each assertion below true of nothing.
    for (const tag of ["DatePicker", "TimeField", OFFERING]) {
      assert.ok(
        sites.some((site) => site.tag === tag),
        `no <${tag}> found, so what this file grades about it is unproven`,
      );
    }
  });

  for (const [file, text] of sources) {
    const calendars = sites.filter((site) => site.file === file && site.tag === OFFERING);
    // Derived from what the file DECLARES, never from the attribute text this asserts: conditioning on
    // `text.includes("minValue")` lets a bound removed with its prop drop the file out of the sweep.
    const declared = BOUNDS.filter((bound) => bound !== "isDateUnavailable" && declaresProp(file, text, bound));
    if (calendars.length === 0 || declared.length === 0) continue;

    it(`${file} hands the bounds it declares to the calendar that offers the days`, () => {
      for (const bound of declared) {
        assert.ok(
          calendars.some((calendar) => calendar.bounds.includes(bound)),
          `${file} declares ${bound} but no <Calendar> in it carries one with a value, so an illegal day is still pickable`,
        );
      }
    });
  }
});
