import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

const ICON_PACKAGE = "@gravity-ui/icons";

const shown = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join("/");

type Icon = { where: string; tag: string; viaAlias: boolean; names: string[] };

/** Every element in one module that renders an icon, with the attributes it is written with. */
function iconsIn(file: string, text: string): Icon[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const imported = new Set<string>();
  const takeImports = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith(ICON_PACKAGE)) {
      const clause = node.importClause;
      if (clause?.name !== undefined) imported.add(clause.name.text);
      if (clause?.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) imported.add(element.name.text);
      }
    }
    ts.forEachChild(node, takeImports);
  };
  takeImports(source);
  if (imported.size === 0) return [];

  /* An icon reaches a tag under a name of its own as often as under the imported one, and a reader
     watching the imports alone passes every dictionary in the tree without looking at it. */
  const dictionaries = new Set<string>();
  const iconKeys = new Set<string>(["icon"]);

  const takeDictionaries = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      const assignments = node.properties.filter(ts.isPropertyAssignment);
      for (const property of assignments) {
        if (imported.has(property.initializer.getText(source))) iconKeys.add(property.name.getText(source));
      }

      // Up through `as const` and any parentheses: an assertion sits between the literal and the
      // declaration, so a reader stopping at the immediate parent never finds the name.
      let owner: ts.Node | undefined = node.parent;
      while (owner !== undefined && (ts.isAsExpression(owner) || ts.isParenthesizedExpression(owner) || ts.isSatisfiesExpression(owner))) {
        owner = owner.parent;
      }

      const values = assignments.map((property) => property.initializer.getText(source));
      if (
        values.length > 0 &&
        values.every((value) => imported.has(value)) &&
        owner !== undefined &&
        ts.isVariableDeclaration(owner) &&
        ts.isIdentifier(owner.name)
      ) {
        dictionaries.add(owner.name.text);
      }
    }
    ts.forEachChild(node, takeDictionaries);
  };
  takeDictionaries(source);

  const aliases = new Set<string>();
  const takeAliases = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      const root = /^([A-Za-z_$][\w$]*)/.exec(node.initializer.getText(source))?.[1];
      if (root !== undefined && dictionaries.has(root)) aliases.add(node.name.text);
    }
    // `{ Icon }` and `{ icon: Icon }` alike: the property name is what says the value is an icon,
    // and the shorthand spelling has none of its own.
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name) && iconKeys.has(node.propertyName?.getText(source) ?? node.name.text)) {
      aliases.add(node.name.text);
    }
    ts.forEachChild(node, takeAliases);
  };
  takeAliases(source);

  const found: Icon[] = [];
  const visit = (node: ts.Node): void => {
    const opening = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxElement(node) ? node.openingElement : null;
    if (opening !== null) {
      const tag = opening.tagName.getText(source);
      if (imported.has(tag) || aliases.has(tag)) {
        found.push({
          where: `${shown(file)}:${String(source.getLineAndCharacterOfPosition(opening.getStart(source)).line + 1)}`,
          tag,
          viaAlias: !imported.has(tag),
          names: opening.attributes.properties.filter(ts.isJsxAttribute).map((property) => property.name.getText(source)),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

const files = filesUnder(SRC_DIR, (name) => name.endsWith(".tsx") && !isTestFile(name), 250);
const icons = files.flatMap((file) => iconsIn(file, readFileSync(file, "utf8")));
const filesWithAnIcon = new Set(icons.map((icon) => icon.where.split(":")[0]));

describe("every icon the tree renders", () => {
  /* A floor over both listings: the files come from the walk and the elements from reading them,
     so a reader that went blind on either fails here rather than passing over nothing. */
  it("is found by the sweep, under an alias as well as under its imported name", () => {
    assert.ok(icons.length >= 110, `the sweep read ${String(icons.length)} icon elements, far under what the tree renders`);
    assert.ok(filesWithAnIcon.size >= 60, `only ${String(filesWithAnIcon.size)} files yielded an icon`);

    // The third listing, whose own floor is what an alias resolution resolving nothing would miss.
    const aliased = icons.filter((icon) => icon.viaAlias);
    assert.ok(
      aliased.length >= 5,
      `only ${String(aliased.length)} icons were reached through a dictionary or an \`icon\` prop, so that resolution read nothing`,
    );
  });

  /* The svg's own `width` and `height` are pixels, so an icon sized by them ignores a reader who
     raised their browser's font size while every `size-*` icon beside it grows. */
  it("takes its size from a class, never from a width or height prop", () => {
    const found = icons.filter((icon) => icon.names.includes("width") || icon.names.includes("height"));
    assert.deepEqual(
      found.map((icon) => icon.where),
      [],
      `a width or height prop sizes an icon in pixels, off §1.21's ladder:\n${found.map((icon) => `${icon.where}: <${icon.tag}>`).join("\n")}`,
    );
  });
});
