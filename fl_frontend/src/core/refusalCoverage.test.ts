import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { DOCUMENT_PATH, REGENERATE_CITATION } from "@/core/openapiDocument.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** The reader every slice test asks the document through, whose calls this sweep collects. */
const READER = "publishedRefusals";

/**
 * Under the 409s the document carries and the operations the tests ask about, with room for a write
 * retired as ordinary product change (`docs/frontend/spec.md` §1.9).
 */
const PUBLISHED_FLOOR = 35;
const ASKED_FLOOR = 35;

type Asked = { operations: string[]; unreadable: string[] };

/**
 * The operations a test module asks the reader about, and the calls it cannot resolve: an argument is
 * a literal or a `const` the module binds once, and an alias or a namespace hides no call.
 */
function operationsAsked(fileName: string, source: string): Asked {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const namespaces = new Set<string>();
  const constants = new Map<string, string[]>();

  const literalOf = (node: ts.Expression): string | null =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;

  const collect = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /\/publishedRefusals(\.ts)?$/.test(node.moduleSpecifier.text)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) if ((element.propertyName ?? element.name).text === READER) names.add(element.name.text);
      }
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    }
    if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const) !== 0) {
      for (const declaration of node.declarations) {
        const value = declaration.initializer === undefined ? null : literalOf(declaration.initializer);
        if (ts.isIdentifier(declaration.name) && value !== null) {
          constants.set(declaration.name.text, [...(constants.get(declaration.name.text) ?? []), value]);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(file);

  const found: Asked = { operations: [], unreadable: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isReader =
        (ts.isIdentifier(callee) && names.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) &&
          ts.isIdentifier(callee.expression) &&
          namespaces.has(callee.expression.text) &&
          callee.name.text === READER);

      if (isReader) {
        const [argument] = node.arguments;
        const literal = argument === undefined ? null : literalOf(argument);
        // One binding and no more: a name bound twice in the module could be either at the call.
        const bound = argument !== undefined && ts.isIdentifier(argument) ? constants.get(argument.text) : undefined;
        const operation = literal ?? (bound?.length === 1 ? bound[0] : undefined);
        const at = `${fileName}:${String(file.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;

        if (operation === undefined) found.unreadable.push(`${at} ${node.getText(file)}`);
        else found.operations.push(operation);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return found;
}

/** Every operation the document publishes a 409 on, spelled as the reader is asked for it. */
function operationsRefusing(): string[] {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read ${DOCUMENT_PATH}. Generate it with the command ${REGENERATE_CITATION} declares.`, { cause });
  }
  const paths = (document as { paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>> }).paths ?? {};

  return Object.entries(paths).flatMap(([published, operations]) =>
    Object.entries(operations)
      .filter(([, operation]) => operation.responses !== undefined && "409" in operation.responses)
      // The version prefix off, as the backend's own routes spell an operation.
      .map(([method]) => `${method.toUpperCase()} ${published.replace(/^\/api\/v\d+/, "")}`),
  );
}

describe("the operation reader the sweep below rests on", () => {
  /* Held against a sample rather than the tree alone: were every call in the tree a literal, a reader
     that stopped at literals would pass there and miss the first constant. */
  it("reads a literal, a constant, an alias and a namespace, and reports what it cannot read", () => {
    const sample = [
      'import { publishedRefusals } from "@/shared/testing/publishedRefusals.ts";',
      'import { publishedRefusals as asked } from "./publishedRefusals";',
      'import * as documents from "@/shared/testing/publishedRefusals.ts";',
      'const EDIT = "PATCH /x/{x_id}";',
      'publishedRefusals("POST /x");',
      "publishedRefusals(EDIT);",
      "asked(`DELETE /x/{x_id}`);",
      'documents.publishedRefusals("POST /y");',
      "for (const operation of [EDIT]) publishedRefusals(operation);",
      'somethingElse("POST /z");',
    ].join("\n");

    const asked = operationsAsked("sample.test.ts", sample);

    assert.deepEqual(asked.operations, ["POST /x", "PATCH /x/{x_id}", "DELETE /x/{x_id}", "POST /y"]);
    assert.deepEqual(asked.unreadable, ["sample.test.ts:9 publishedRefusals(operation)"]);
  });

  it("reports a constant the module binds twice rather than picking one", () => {
    const sample = [
      'import { publishedRefusals } from "@/shared/testing/publishedRefusals.ts";',
      'function a() { const OP = "POST /a"; return OP; }',
      'const OP = "POST /b";',
      "publishedRefusals(OP);",
    ].join("\n");

    assert.equal(operationsAsked("twice.test.ts", sample).unreadable.length, 1);
  });
});

describe("every published 409 against the tests that ask about it", () => {
  const refusing = new Set(operationsRefusing());
  const asked = filesUnder(SRC_DIR, isTestFile, 250).map((file) =>
    operationsAsked(path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")),
  );
  const askedOperations = new Set(asked.flatMap((one) => one.operations));

  it("finds the document's 409s and the tests' questions at all", () => {
    assert.ok(
      refusing.size >= PUBLISHED_FLOOR,
      `the document publishes ${String(refusing.size)} 409s, under the floor of ${String(PUBLISHED_FLOOR)}`,
    );
    assert.ok(
      askedOperations.size >= ASKED_FLOOR,
      `the tests ask about ${String(askedOperations.size)} operations, under the floor of ${String(ASKED_FLOOR)}`,
    );
  });

  /* A call this sweep cannot resolve is a question it cannot credit, so it fails rather than shrinking
     the set below. */
  it("reads every call to the reader", () => {
    assert.deepEqual(
      asked.flatMap((one) => one.unreadable),
      [],
    );
  });

  /* The half the slice tests cannot hold between them: a 409 no test asks about reaches the admin
     through the shared fallback, which tells them an equivalent entry already exists
     (`.claude/rules/cross-surface.md`). */
  it("asks some test about every operation the document publishes a 409 on", () => {
    assert.deepEqual(
      [...refusing].filter((operation) => !askedOperations.has(operation)).sort(),
      [],
      "a published refusal no test feeds to a mapper",
    );
  });

  it("asks about no operation the document publishes no 409 on", () => {
    assert.deepEqual(
      [...askedOperations].filter((operation) => !refusing.has(operation)).sort(),
      [],
      `a test asks about a refusal the document does not publish; refresh it with the command ${REGENERATE_CITATION} declares`,
    );
  });
});
