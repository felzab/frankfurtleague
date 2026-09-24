import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { keyTierOf } from "@/core/keyTiers.ts";
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

const literalOf = (node: ts.Expression): string | null =>
  ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null;

/**
 * The literal a name is bound to, resolved through the checker's scopes: `null` for any binding but a
 * module-scope `const`, since a parameter or `let` of that name can hold another operation.
 */
function moduleConstantOf(file: ts.SourceFile): (name: ts.Identifier) => string | null {
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (requested) => (requested === file.fileName ? file : undefined);
  const checker = ts.createProgram({ rootNames: [file.fileName], options, host }).getTypeChecker();

  return (name) => {
    const declarations = checker.getSymbolAtLocation(name)?.declarations ?? [];
    const [declaration] = declarations;
    if (declarations.length !== 1 || declaration === undefined || !ts.isVariableDeclaration(declaration)) return null;

    const list = declaration.parent;
    const atModuleScope = ts.isVariableDeclarationList(list) && ts.isVariableStatement(list.parent) && ts.isSourceFile(list.parent.parent);

    return atModuleScope && (list.flags & ts.NodeFlags.Const) !== 0 && declaration.initializer !== undefined
      ? literalOf(declaration.initializer)
      : null;
  };
}

/**
 * The operations a test module asks the reader about, and the calls it cannot resolve: an argument is
 * a literal or a module-scope `const` holding one, and an alias or a namespace hides no call.
 */
function operationsAsked(fileName: string, source: string): Asked {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  const namespaces = new Set<string>();

  for (const statement of file.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      /\/publishedRefusals(\.ts)?$/.test(statement.moduleSpecifier.text)
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) if ((element.propertyName ?? element.name).text === READER) names.add(element.name.text);
      }
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    }
  }

  const found: Asked = { operations: [], unreadable: [] };
  // Built only for a module importing the reader: a program per test file would be most of this run.
  if (names.size === 0 && namespaces.size === 0) return found;
  const constantOf = moduleConstantOf(file);
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
        const operation = argument === undefined ? null : (literalOf(argument) ?? (ts.isIdentifier(argument) ? constantOf(argument) : null));
        const at = `${fileName}:${String(file.getLineAndCharacterOfPosition(node.getStart()).line + 1)}`;

        if (operation === null) found.unreadable.push(`${at} ${node.getText(file)}`);
        else found.operations.push(operation);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return found;
}

/** Every operation outside the system tier the document publishes a 409 on, spelled as the reader is asked for it. */
function operationsRefusing(): string[] {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read ${DOCUMENT_PATH}. Generate it with the command ${REGENERATE_CITATION} declares.`, { cause });
  }
  const paths =
    (document as { paths?: Record<string, Record<string, Record<string, unknown> & { responses?: Record<string, unknown> }>> }).paths ?? {};

  return Object.entries(paths).flatMap(([published, operations]) =>
    Object.entries(operations)
      .filter(([, operation]) => operation.responses !== undefined && "409" in operation.responses)
      // Left out on the premise that a system caller hands no refusal to a person, the way
      // `fl_frontend/src/features/zustellung/notifications.ts :: meldeAngenommen` catches and logs one.
      .filter(([, operation]) => keyTierOf(operation) !== "system")
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

  /* By the binding in scope at the call and never by the name: a module constant a parameter or a
     `let` shadows would otherwise credit the operation the constant names, whatever the call asks. */
  it("credits a module constant only where the call reads that constant", () => {
    const sample = [
      'import { publishedRefusals } from "@/shared/testing/publishedRefusals.ts";',
      'const OP = "POST /a";',
      "function asked(OP: string) { publishedRefusals(OP); }",
      'function reassigned() { let OP = "POST /b"; OP = "POST /c"; publishedRefusals(OP); }',
      'function inner() { const OP = "POST /d"; publishedRefusals(OP); }',
      "publishedRefusals(OP);",
    ].join("\n");

    const asked = operationsAsked("shadowed.test.ts", sample);

    assert.deepEqual(asked.operations, ["POST /a"]);
    assert.deepEqual(asked.unreadable, [
      "shadowed.test.ts:3 publishedRefusals(OP)",
      "shadowed.test.ts:4 publishedRefusals(OP)",
      "shadowed.test.ts:5 publishedRefusals(OP)",
    ]);
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
