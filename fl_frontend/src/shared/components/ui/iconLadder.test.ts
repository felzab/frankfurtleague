import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/** `docs/frontend/spec.md` §1.21's rungs, declared once so no reader here can hold a ninth. */
const RUNGS = ["3", "3.5", "4", "4.5", "5", "6", "7", "10"];

/**
 * The two sizings that stand on no rung: an icon filling a box the ladder already sized, and the
 * hint glyph, whose variable is `1em` so it tracks the sentence it sits in rather than the scale.
 */
const OFF_THE_SCALE = ["size-full", "size-(--hint-icon-size)"];

const ICON_PACKAGE = "@gravity-ui/icons";

/** A class that declares a width, a height or both — the three spellings one icon's size can take. */
const SIZING = /^(?:size|[hw])-/;

const shown = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join("/");

type Icon = { where: string; tag: string; viaAlias: boolean; classes: string[] | null; names: string[] };

/**
 * Every element in one module that renders an icon, with the class list and the accessible marks it
 * carries. `classes` is null where no reader below could resolve the class list.
 */
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

  /** A file-local constant's own strings, so `className={TONE[severity]}` is a class list rather than a shrug. */
  const constantStrings = (expression: ts.Expression): string[] | null => {
    const root = ts.isIdentifier(expression) ? expression : ts.isElementAccessExpression(expression) ? expression.expression : null;
    if (root === null || !ts.isIdentifier(root)) return null;

    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === root.text && node.initializer !== undefined) {
        let value: ts.Expression = node.initializer;
        while (ts.isAsExpression(value) || ts.isParenthesizedExpression(value) || ts.isSatisfiesExpression(value)) value = value.expression;

        if (ts.isStringLiteralLike(value)) found.push(value.text);
        else if (ts.isObjectLiteralExpression(value)) {
          for (const property of value.properties) {
            if (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer)) found.push(property.initializer.text);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    return found.length === 0 ? null : found;
  };

  /** `styles.icon()` off a `tv({ slots, variants })`: every string this module writes under that slot. */
  const slotStrings = (expression: ts.Expression): string[] | null => {
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) return null;
    const slot = expression.expression.name.text;

    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      if (ts.isPropertyAssignment(node) && node.name.getText(source) === slot && ts.isStringLiteralLike(node.initializer))
        found.push(node.initializer.text);
      ts.forEachChild(node, visit);
    };
    visit(source);

    return found.length === 0 ? null : found;
  };

  const classesOf = (opening: ts.JsxOpeningLikeElement): string[] | null => {
    const declared = opening.attributes.properties.find(
      (property) => ts.isJsxAttribute(property) && property.name.getText(source) === "className",
    );
    if (declared === undefined) return [];

    const value = ts.isJsxAttribute(declared) ? declared.initializer : undefined;
    if (value === undefined) return null;

    const split = (text: string): string[] => text.split(/\s+/).filter((token) => token !== "");
    if (ts.isStringLiteralLike(value)) return split(value.text);

    if (ts.isJsxExpression(value) && value.expression !== undefined) {
      const expression = value.expression;
      if (ts.isStringLiteralLike(expression)) return split(expression.text);
      // The static halves of a template: an interpolation carries no class a reader here can place.
      if (ts.isTemplateExpression(expression)) {
        return split([expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(" "));
      }

      const indirect = constantStrings(expression) ?? slotStrings(expression);
      if (indirect !== null) return split(indirect.join(" "));
    }

    return null;
  };

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
          classes: classesOf(opening),
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

  /* An icon whose class list no reader above could resolve is a size nobody can audit, and the
     population it would silently leave is the whole point of the ladder. */
  it("writes that class where this reader can find it", () => {
    const unreadable = icons.filter((icon) => icon.classes === null);
    assert.deepEqual(
      unreadable.map((icon) => icon.where),
      [],
      `an icon's class list resolves to nothing this sweep can read:\n${unreadable.map((icon) => `${icon.where}: <${icon.tag}>`).join("\n")}`,
    );

    // No sizing class at all leaves the svg's own `width={16}`, which is a size written nowhere.
    const unsized = icons.filter((icon) => icon.classes !== null && !icon.classes.some((name) => SIZING.test(name)));
    assert.deepEqual(
      unsized.map((icon) => icon.where),
      [],
      `an icon declares no size, so it renders at the package's own 16px:\n${unsized.map((icon) => `${icon.where}: <${icon.tag}>`).join("\n")}`,
    );
  });

  it("stands on one of the eight rungs", () => {
    const offLadder: string[] = [];

    for (const icon of icons) {
      for (const name of icon.classes ?? []) {
        if (!SIZING.test(name) || OFF_THE_SCALE.includes(name)) continue;
        const step = /^size-(.+)$/.exec(name)?.[1];
        if (step === undefined || !RUNGS.includes(step)) offLadder.push(`${icon.where}: \`${name}\` on <${icon.tag}>`);
      }
    }

    assert.deepEqual(offLadder, [], `an icon is off §1.21's ladder — a size is one of ${RUNGS.join(" ")}:\n${offLadder.join("\n")}`);
  });

  /* An unnamed `<svg>` usually contributes nothing to a name-from-content walk, so this is the
     consistency the ladder is for rather than a defect each site carries. */
  it("carries the hidden mark, unless it is the thing being named", () => {
    const unmarked = icons.filter((icon) => !["aria-hidden", "aria-label", "role"].some((mark) => icon.names.includes(mark)));
    assert.deepEqual(
      unmarked.map((icon) => icon.where),
      [],
      `a decorative icon carries no \`aria-hidden\`:\n${unmarked.map((icon) => `${icon.where}: <${icon.tag}>`).join("\n")}`,
    );
  });
});
