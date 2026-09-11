import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

/* Three levels up from `src/shared/components/ui`: the rule binds every module under `src`, not the
   directory this file happens to sit in. */
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/** Fewer modules than this and a rename has emptied the walk, leaving every case below vacuous. */
const MODULE_FLOOR = 200;

/** Fewer dressed hosts than this and the reader has stopped resolving class strings, with the same result. */
const HOST_FLOOR = 60;

/* `group-hover` and `peer-hover` key on another element's `:hover` and say nothing about this host,
   which is why neither is here. */
const CSS_ARM = /(?:^|:)hover:/;
const ARIA_ARM = /(?:^|:)data-hovered:/;

/**
 * Which arm a host can actually report. `aria` is react-aria's `data-hovered`, written by every
 * component built on `useHover`; `css` is `:hover`, the only thing a plain element has.
 */
const HOVER_FOR_HOST: Record<string, "aria" | "css"> = {
  "@heroui/react::Accordion.Trigger": "aria",
  "@heroui/react::Button": "aria",
  /* A decoration rather than a control: HeroUI builds it on no react-aria component, so it reports
     nothing and takes the plain arm. */
  "@heroui/react::Chip": "css",
  "@heroui/react::Dropdown.Item": "aria",
  "@heroui/react::Dropdown.Trigger": "aria",
  "@heroui/react::ListBox.Item": "aria",
  /* The exception among HeroUI's own: this one is a react-aria `Pressable` around a `div`, and
     `Pressable` merges press and focus props alone. No `data-hovered` reaches the element. */
  "@heroui/react::Popover.Trigger": "css",
  "@heroui/react::Toast.ActionButton": "aria",
  "@heroui/react::ToggleButton": "aria",
  "next/link::default": "css",
};

type Dressed = { file: string; host: string; arm: "aria" | "css"; token: string };

const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** Where an identifier came from, spelled as the module wrote it rather than as this file named it. */
type Origin = { module: string; imported: string };

function originsIn(source: ts.SourceFile): Map<string, Origin> {
  const found = new Map<string, Origin>();
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const from = node.moduleSpecifier.text;
      const clause = node.importClause;
      if (clause?.name) found.set(clause.name.text, { module: from, imported: "default" });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          found.set(element.name.text, { module: from, imported: (element.propertyName ?? element.name).text });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Tagged rather than marked inside the text, so a class string spelling a name cannot be read as one. */
type Piece = { kind: "text" | "name"; value: string };

function piecesOf(node: ts.Node, into: Piece[]): void {
  const visit = (inner: ts.Node): void => {
    if (ts.isStringLiteralLike(inner)) into.push({ kind: "text", value: inner.text });
    else if (ts.isTemplateExpression(inner)) {
      into.push({ kind: "text", value: inner.head.text });
      for (const span of inner.templateSpans) into.push({ kind: "text", value: span.literal.text });
    } else if (ts.isIdentifier(inner)) into.push({ kind: "name", value: inner.text });
    ts.forEachChild(inner, visit);
  };
  visit(node);
}

/** Every module-scope name holding a class string, kept unresolved so one built from another still lands. */
function recipesIn(source: ts.SourceFile): Map<string, Piece[]> {
  const found = new Map<string, Piece[]>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      if (ts.isStringLiteralLike(node.initializer) || ts.isTemplateExpression(node.initializer)) {
        const pieces: Piece[] = [];
        piecesOf(node.initializer, pieces);
        found.set(node.name.text, pieces);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** The leftmost name of a tag, which is the one an import declared. */
function rootOf(tag: ts.JsxTagNameExpression): string | null {
  let at: ts.Node = tag;
  while (ts.isPropertyAccessExpression(at)) at = at.expression;
  return ts.isIdentifier(at) ? at.text : null;
}

function hostOf(tag: ts.JsxTagNameExpression, source: ts.SourceFile, origins: Map<string, Origin>): string | null {
  const spelled = tag.getText(source);
  // A lowercase first letter is JSX's own rule for an intrinsic element, which is a DOM node.
  if (/^[a-z]/.test(spelled)) return "intrinsic";
  const root = rootOf(tag);
  const origin = root === null ? undefined : origins.get(root);
  if (root === null || origin === undefined) return null;

  return `${origin.module}::${origin.imported}${spelled.slice(root.length)}`;
}

function dressedIn(file: string, text: string): Dressed[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const origins = originsIn(source);
  const recipes = recipesIn(source);

  const resolve = (pieces: Piece[], seen: ReadonlySet<string>): string[] =>
    pieces.flatMap((piece) => {
      if (piece.kind === "text") return [piece.value];
      const held = recipes.get(piece.value);
      return held === undefined || seen.has(piece.value) ? [] : resolve(held, new Set([...seen, piece.value]));
    });

  const found: Dressed[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== "className") continue;
        if (attribute.initializer === undefined) continue;

        const raw: Piece[] = [];
        piecesOf(attribute.initializer, raw);
        const tokens = resolve(raw, new Set()).flatMap((piece) => piece.split(/\s+/));
        for (const token of tokens) {
          const arm = ARIA_ARM.test(token) ? "aria" : CSS_ARM.test(token) ? "css" : null;
          if (arm === null) continue;
          found.push({ file, host: hostOf(node.tagName, source, origins) ?? "unknown", arm, token });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/* `.tsx` alone, JSX being the only place a host and its class sit together. A recipe module reached
   through a prop spread carries its arm as a parameter instead, and is outside this sweep. */
const MODULES = filesUnder(SRC, (name) => name.endsWith(".tsx") && !isTestFile(name), MODULE_FLOOR);
const DRESSED = MODULES.flatMap((file) => dressedIn(relative(file), readFileSync(file, "utf8")));

describe("the population this rule is read over", () => {
  /* No hosts and every case below passes over an empty list, which is how a broken class reader
     reports a clean tree (`docs/_standard/standard.md :: PRE-4`). */
  it("still reads the hovers the tree already dresses its hosts in", () => {
    assert.ok(
      DRESSED.length >= HOST_FLOOR,
      `expected at least ${String(HOST_FLOOR)} dressed hosts across ${String(MODULES.length)} modules, found ${String(DRESSED.length)}`,
    );
  });

  /* An unlisted host is a host nobody has checked: whether it writes `data-hovered` is the
     library's answer, not a guess, and the table is where that answer is recorded. */
  it("knows every host it meets", () => {
    const unlisted = [
      ...new Set(DRESSED.filter((one) => one.host !== "intrinsic" && HOVER_FOR_HOST[one.host] === undefined).map((one) => one.host)),
    ].sort();

    assert.deepEqual(
      unlisted,
      [],
      `these hosts wear a hover this file cannot grade -- check whether each writes \`data-hovered\` and add it to \`HOVER_FOR_HOST\`:\n  ${unlisted.join("\n  ")}`,
    );
  });
});

describe("the hover each host is dressed for", () => {
  it("takes the arm its own host can report", () => {
    const wrong = DRESSED.filter((one) => {
      const wanted = one.host === "intrinsic" ? "css" : HOVER_FOR_HOST[one.host];
      return wanted !== undefined && one.arm !== wanted;
    }).map((one) => `${one.file}  <${one.host}>  ${one.token}`);

    assert.deepEqual(
      wrong,
      [],
      `a \`css\` arm on a react-aria host latches after a tap, and an \`aria\` arm on a plain element never paints:\n  ${wrong.join("\n  ")}`,
    );
  });
});
