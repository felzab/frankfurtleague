import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** The names the builder stage itself sets; a name added here is a claim about the Dockerfile (`docs/frontend/spec.md :: I84`). */
const PROVIDED_WHILE_BUILDING = new Set(["MONGODB_URI", "NODE_ENV", "NEXT_RUNTIME", "NEXT_TELEMETRY_DISABLED"]);

const collectModules = (dir: string): string[] => filesUnder(dir, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 350);

interface Finding {
  readonly line: number;
  readonly shape: string;
  readonly source: string;
}

const isFunctionLike = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isGetAccessor(node) ||
  ts.isSetAccessor(node) ||
  ts.isConstructorDeclaration(node);

/** Every module-scope expression that CONSUMES a value the builder leaves undefined (`docs/frontend/spec.md :: I45`). */
function moduleScopeConsumers(fileName: string, source: string): Finding[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.ESNext,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const derived = new Set<string>();
  const findings: Finding[] = [];

  const unwrap = (node: ts.Node): ts.Node =>
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) ? unwrap(node.expression) : node;

  /** A name the builder does not set, read off the validated config or off `process.env` directly. */
  function isEnvRead(node: ts.Node): boolean {
    if (!ts.isPropertyAccessExpression(node)) return false;
    if (ts.isIdentifier(node.expression) && node.expression.text === "frontend_config") return !PROVIDED_WHILE_BUILDING.has(node.name.text);

    const inner = node.expression;
    const readsProcessEnv =
      ts.isPropertyAccessExpression(inner) &&
      ts.isIdentifier(inner.expression) &&
      inner.expression.text === "process" &&
      inner.name.text === "env";

    return readsProcessEnv && !PROVIDED_WHILE_BUILDING.has(node.name.text);
  }

  /**
   * What the expression EVALUATES to. Composition carries the value; an object literal, an array or a
   * function body does not, a read inside one being its own site.
   */
  function resolvesToEnv(node: ts.Node): boolean {
    const inner = unwrap(node);
    if (isEnvRead(inner)) return true;
    if (ts.isIdentifier(inner)) return derived.has(inner.text);
    if (ts.isTemplateExpression(inner)) return inner.templateSpans.some((span) => resolvesToEnv(span.expression));
    if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return resolvesToEnv(inner.left) || resolvesToEnv(inner.right);
    }
    // A fallback still carries the value; what excuses the site is `isGuarded`, so that the two are
    // separable and an empty-string fallback into a URL parse is still reported.
    if (
      ts.isBinaryExpression(inner) &&
      (inner.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || inner.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      return resolvesToEnv(inner.left);
    }
    return false;
  }

  /** A fallback or a branch stands something else in where the value is missing, and nothing throws. */
  function isGuarded(node: ts.Node): boolean {
    const fallback = (candidate: ts.Node): boolean =>
      ts.isBinaryExpression(candidate) &&
      (candidate.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || candidate.operatorToken.kind === ts.SyntaxKind.BarBarToken);

    if (fallback(unwrap(node))) return true;

    let ancestor: ts.Node | undefined = node.parent;
    while (ancestor !== undefined && !isFunctionLike(ancestor)) {
      if (fallback(ancestor) || ts.isConditionalExpression(ancestor) || ts.isIfStatement(ancestor)) return true;
      ancestor = ancestor.parent;
    }
    return false;
  }

  function record(node: ts.Node, shape: string): void {
    if (!resolvesToEnv(node) || isGuarded(node)) return;

    findings.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      shape,
      source: node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 80),
    });
  }

  function visit(node: ts.Node): void {
    // A body runs when it is called, not when the module loads, so nothing inside one is a subject.
    if (isFunctionLike(node)) return;

    if (ts.isCallExpression(node) || ts.isNewExpression(node))
      for (const argument of node.arguments ?? []) record(argument, "passed to a call");
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !isEnvRead(node))
      record(node.expression, "reached through");
    if (ts.isSpreadElement(node)) record(node.expression, "spread");
    if (ts.isForOfStatement(node)) record(node.expression, "iterated");

    ts.forEachChild(node, visit);
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer !== undefined && ts.isIdentifier(declaration.name) && resolvesToEnv(declaration.initializer)) {
          derived.add(declaration.name.text);
        }
      }
    }
    visit(statement);
  }
  return findings;
}

const modules = collectModules(SRC_DIR);

/** Every module reading a build-time name at all, at module scope or from inside a function. */
const envReaders = modules.filter((file) => /frontend_config\.|process\.env\./.test(readFileSync(file, "utf8")));

describe("what a module does with the environment while the image builds", () => {
  it("tells a consumed value from a composed one, and a module's body from a function's", () => {
    /* The reader on input, because the tree is CLEAN and a sweep that saw nothing would report the
       same answer (`docs/frontend/spec.md` §1.9). */
    const sample = [
      'import { frontend_config } from "./config";',
      "",
      "const BASE = `${frontend_config.API_URL}/api/v${frontend_config.API_VERSION}`;",
      "",
      "const parsedAtLoad = new URL(BASE);",
      "",
      "export const parseLater = () => new URL(BASE);",
      "",
      "const upperAtLoad = frontend_config.AUTH_SECRET.toUpperCase();",
      "",
      'const secure = (frontend_config.AUTH_URL ?? "").startsWith("https://");',
      "",
      "if (frontend_config.API_URL) new URL(frontend_config.API_URL);",
      "",
      'const fromALiteral = new URL("https://example.test/api/v1");',
      "",
      "const client = new MongoClient(frontend_config.MONGODB_URI);",
    ].join("\n");

    /* Composed, deferred, guarded, branched, builder-set, and a LITERAL parse: none is a subject.
       Line 5 parses at load and line 9 reaches through one. */
    const found = moduleScopeConsumers("sample.ts", sample);

    assert.deepEqual(
      found.map((finding) => `${String(finding.line)} ${finding.shape}`),
      ["5 passed to a call", "9 reached through"],
      `the reader saw: ${found.map((finding) => `${String(finding.line)}:${finding.source}`).join(" | ")}`,
    );
  });

  it("parsed the tree and found the modules that read the environment", () => {
    // Floors, because the tree carries no consumer today: a reader that had stopped resolving would
    // report the same clean answer a correct one does, and only these two would notice.
    const components = modules.filter((file) => file.endsWith(".tsx"));
    assert.ok(
      modules.length - components.length >= 180,
      `expected at least 180 modules to parse, found ${String(modules.length - components.length)}`,
    );
    assert.ok(components.length >= 250, `expected at least 250 components to parse, found ${String(components.length)}`);
    assert.ok(envReaders.length >= 5, `expected at least 5 modules reading the environment, found ${String(envReaders.length)}`);
  });

  it("consumes nothing the builder leaves undefined, in any module", () => {
    /* Nothing else in the toolchain sees this: `tsc`, ESLint, the suite and `next dev` all run where
       the value is present, and the gate stops short of `images`. */
    const consumers = modules.flatMap((file) =>
      moduleScopeConsumers(file, readFileSync(file, "utf8")).map(
        (finding) => `${path.relative(SRC_DIR, file).split(path.sep).join("/")}:${String(finding.line)} ${finding.shape} — ${finding.source}`,
      ),
    );

    assert.deepEqual(
      consumers,
      [],
      "a module reads an environment value the builder leaves undefined, while it loads. Defer it into a function, or give it a fallback.",
    );
  });
});
