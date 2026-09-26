import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/**
 * The names the builder stage itself sets, its `node` base image's `NODE_VERSION` among them; a name added
 * here is a claim about the Dockerfile and that image (`docs/frontend/spec.md :: I84`).
 */
const PROVIDED_WHILE_BUILDING = new Set([
  "CI",
  "MONGODB_URI",
  "NEXT_RUNTIME",
  "NEXT_TELEMETRY_DISABLED",
  "NODE_ENV",
  "NODE_VERSION",
  "PATH",
  "PNPM_HOME",
  "SKIP_ENV_VALIDATION",
]);

/** The validated source (`fl_frontend/src/core/config.ts :: frontend_config`): every read off it is a value, and the call building it is no subject. */
const VALIDATED_CONFIG = "frontend_config";

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
  const holders = new Map<string, ts.ObjectLiteralExpression | ts.ArrayLiteralExpression>();
  const findings: Finding[] = [];
  let validator: ts.Node | undefined;

  const unwrap = (node: ts.Node): ts.Node =>
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)
      ? unwrap(node.expression)
      : node;

  const isFallback = (node: ts.Node): node is ts.BinaryExpression =>
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || node.operatorToken.kind === ts.SyntaxKind.BarBarToken);

  /** A name the builder does not set, read off the validated config or off `process.env` directly. */
  function isEnvRead(node: ts.Node): boolean {
    if (!ts.isPropertyAccessExpression(node)) return false;
    if (ts.isIdentifier(node.expression) && node.expression.text === VALIDATED_CONFIG) return !PROVIDED_WHILE_BUILDING.has(node.name.text);

    const inner = node.expression;
    const readsProcessEnv =
      ts.isPropertyAccessExpression(inner) &&
      ts.isIdentifier(inner.expression) &&
      inner.expression.text === "process" &&
      inner.name.text === "env";

    return readsProcessEnv && !PROVIDED_WHILE_BUILDING.has(node.name.text);
  }

  /**
   * What the expression EVALUATES to. Composition carries the value, and so does a member read back
   * out of a literal; the literal itself does not, since holding an undefined member throws nothing.
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
    // separable and a fallback bound to a name, then parsed as a URL through that name, is still reported.
    if (isFallback(inner)) return resolvesToEnv(inner.left);
    if (ts.isPropertyAccessExpression(inner)) {
      const member = memberOf(inner);
      return member !== undefined && resolvesToEnv(member);
    }
    return false;
  }

  /** The literal an expression stands for: written in place, bound to a module-scope name, or a member of either. */
  function literalOf(node: ts.Node): ts.ObjectLiteralExpression | ts.ArrayLiteralExpression | undefined {
    const inner = unwrap(node);
    if (ts.isObjectLiteralExpression(inner) || ts.isArrayLiteralExpression(inner)) return inner;
    if (ts.isIdentifier(inner)) return holders.get(inner.text);
    const member = ts.isPropertyAccessExpression(inner) ? memberOf(inner) : undefined;
    return member === undefined ? undefined : literalOf(member);
  }

  /** The value an object literal writes for the name read off it; the last one written wins, as at run time. */
  function memberOf(access: ts.PropertyAccessExpression): ts.Node | undefined {
    const outer = literalOf(access.expression);
    if (outer === undefined || !ts.isObjectLiteralExpression(outer)) return undefined;

    let value: ts.Node | undefined;
    for (const property of outer.properties) {
      const name = property.name;
      if (name === undefined || !(ts.isIdentifier(name) || ts.isStringLiteral(name)) || name.text !== access.name.text) continue;
      if (ts.isPropertyAssignment(property)) value = property.initializer;
      if (ts.isShorthandPropertyAssignment(property)) value = property.name;
    }
    return value;
  }

  /**
   * A literal handed to a call hands on every value written into it: `betterAuth({ secret })` gives
   * the callee the secret as surely as `betterAuth(secret)` does.
   */
  function carriesEnv(node: ts.Node, atTheCall = true): boolean {
    const inner = unwrap(node);
    const literal = literalOf(inner);
    if (literal === undefined) return false;

    // A fallback excuses a member written at the call and not one carried there through a name, as
    // `isGuarded` excuses a bare argument.
    const written = atTheCall && literal === inner;
    const values = ts.isArrayLiteralExpression(literal)
      ? literal.elements.map((element) => (ts.isSpreadElement(element) ? element.expression : element))
      : literal.properties.flatMap((property) => {
          if (ts.isPropertyAssignment(property)) return [property.initializer];
          if (ts.isShorthandPropertyAssignment(property)) return [property.name];
          if (ts.isSpreadAssignment(property)) return [property.expression];
          return [];
        });
    return values.some((value) => (resolvesToEnv(value) && !(written && isFallback(unwrap(value)))) || carriesEnv(value, written));
  }

  /** A fallback or a branch stands something else in where the value is missing, and nothing throws. */
  function isGuarded(node: ts.Node): boolean {
    if (isFallback(unwrap(node))) return true;

    let ancestor: ts.Node | undefined = node.parent;
    while (ancestor !== undefined && !isFunctionLike(ancestor)) {
      if (isFallback(ancestor) || ts.isConditionalExpression(ancestor) || ts.isIfStatement(ancestor)) return true;
      ancestor = ancestor.parent;
    }
    return false;
  }

  function record(node: ts.Node, shape: string, consumed: (candidate: ts.Node) => boolean = resolvesToEnv): void {
    if (!consumed(node) || isGuarded(node)) return;

    findings.push({
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      shape,
      source: node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 80),
    });
  }

  function visit(node: ts.Node): void {
    // A body runs when it is called, not when the module loads, so nothing inside one is a subject.
    if (isFunctionLike(node)) return;

    if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node !== validator)
      for (const argument of node.arguments ?? []) record(argument, "passed to a call", (value) => resolvesToEnv(value) || carriesEnv(value));
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && !isEnvRead(node))
      record(node.expression, "reached through");
    if (ts.isSpreadElement(node)) record(node.expression, "spread");
    if (ts.isForOfStatement(node)) record(node.expression, "iterated");

    ts.forEachChild(node, visit);
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer === undefined || !ts.isIdentifier(declaration.name)) continue;

        const literal = literalOf(declaration.initializer);
        if (resolvesToEnv(declaration.initializer)) derived.add(declaration.name.text);
        else if (literal !== undefined && carriesEnv(literal, false)) holders.set(declaration.name.text, literal);

        // Only the call's own arguments are spared, never a read consumed inside them
        // (`docs/frontend/spec.md` §1.9).
        if (declaration.name.text === VALIDATED_CONFIG) validator = unwrap(declaration.initializer);
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
      "",
      "const auth = betterAuth({ database: client, secret: frontend_config.AUTH_SECRET });",
      "",
      "const options = { mail: { from: frontend_config.AUTH_URL } } satisfies MailerOptions;",
      "",
      "const mailer = createMailer(options);",
      "",
      "const fromAtLoad = options.mail.from.trim();",
      "",
      'const withFallback = createMailer({ mail: { from: frontend_config.AUTH_URL ?? "" } });',
      "",
      "const deferred = createMailer({ from: () => frontend_config.AUTH_URL });",
      "",
      'const fallbackHeld = { from: frontend_config.AUTH_URL ?? "" };',
      "",
      "const handedOn = createMailer(fallbackHeld);",
      "",
      "export const frontend_config = createEnv({ runtimeEnv: { AUTH_URL: process.env.AUTH_URL, API_URL: new URL(process.env.API_URL).href } });",
    ].join("\n");

    /* Composed, deferred, guarded, branched, builder-set, a LITERAL parse, a literal holding a value,
       and the validator's own input: none is a subject. Line 33 hands on a fallback away from its
       site; line 35 parses inside the validator's input. */
    const found = moduleScopeConsumers("sample.ts", sample);

    assert.deepEqual(
      found.map((finding) => `${String(finding.line)} ${finding.shape}`),
      [
        "5 passed to a call",
        "9 reached through",
        "19 passed to a call",
        "23 passed to a call",
        "25 reached through",
        "33 passed to a call",
        "35 passed to a call",
      ],
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
