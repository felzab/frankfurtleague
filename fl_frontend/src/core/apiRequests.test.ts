import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

const SRC_DIR = path.resolve(import.meta.dirname, "..");
const FRONTEND_DIR = path.resolve(SRC_DIR, "..");
const FEATURES_DIR = path.resolve(SRC_DIR, "features");
const CLIENT_MODULE = path.resolve(SRC_DIR, "core", "api.ts");
const DOCUMENT_PATH = path.resolve(FRONTEND_DIR, "..", "fl_backend", "openapi.json");

const REGENERATE = "cd fl_backend && python -m tests.openapi_document --write";

/** Stands in for an interpolated segment, spelled so no literal segment can collide with it. */
const PATH_PARAM = "<param>";

/** The unversioned root probe. Every other published path sits under the version prefix. */
const UNVERSIONED = ["/"];

const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

type JsonObject = Record<string, unknown>;

const asPosix = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join("/");

function readDocument(): JsonObject {
  try {
    return JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as JsonObject;
  } catch (cause) {
    throw new Error(`Could not read ${DOCUMENT_PATH}. Generate it with:  ${REGENERATE}`, { cause });
  }
}

const document = readDocument();
const publishedPaths = (document.paths ?? {}) as Record<string, JsonObject>;

/**
 * Derived, never written down: the document is generated under the test configuration, so its
 * number is whatever `API_VERSION` was then, while `fl_frontend/src/core/api.ts` builds the same
 * prefix from the deployed environment.
 */
const versionPrefixes = [...new Set(Object.keys(publishedPaths).flatMap((published) => /^\/api\/v\d+(?=\/|$)/.exec(published) ?? []))];
const versionPrefix = versionPrefixes[0] ?? "";
const unplaceable = Object.keys(publishedPaths).filter((published) => !UNVERSIONED.includes(published) && !published.startsWith(versionPrefix));

/** One operation as published: what it answers on, and the query parameter names it will read. */
type PublishedOperation = { published: string; queryParams: Set<string> };

function queryParamNames(...groups: unknown[]): string[] {
  return groups.flatMap((group) =>
    (Array.isArray(group) ? (group as JsonObject[]) : []).flatMap((parameter) =>
      parameter.in === "query" && typeof parameter.name === "string" ? [parameter.name] : [],
    ),
  );
}

/** A `{team_id}` collapses to the same placeholder an interpolated call site produces. */
function publishedSegments(published: string): string[] {
  return published
    .slice(versionPrefix.length)
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => (segment.startsWith("{") && segment.endsWith("}") ? PATH_PARAM : segment));
}

const operationKey = (method: string, segments: readonly string[]): string => `${method.toUpperCase()} /${segments.join("/")}`;

const published = new Map<string, PublishedOperation>();
for (const [publishedPath, item] of Object.entries(publishedPaths)) {
  if (UNVERSIONED.includes(publishedPath) || unplaceable.includes(publishedPath)) continue;
  const segments = publishedSegments(publishedPath);

  for (const [method, operation] of Object.entries(item)) {
    if (!HTTP_METHODS.has(method)) continue;
    const names = queryParamNames(item.parameters, (operation as JsonObject | undefined)?.parameters);
    published.set(operationKey(method, segments), { published: publishedPath, queryParams: new Set(names) });
  }
}

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

// Every module MENTIONING the client, not the two conventional filenames: a call added under `app/`
// or `shared/` has to fall under the same comparison.
const callerFiles = sourceFilesUnder(SRC_DIR).filter((file) => readFileSync(file, "utf8").includes("apiClient"));

const featureSlices = readdirSync(FEATURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const filterTypeFiles = featureSlices.map((slice) => path.join(FEATURES_DIR, slice, "types.ts")).filter((file) => existsSync(file));

// Modules that must EACH yield a call, so renaming the client cannot quietly empty the run.
const expectedCallerFiles = featureSlices
  .flatMap((slice) => [path.join(FEATURES_DIR, slice, "queries.ts"), path.join(FEATURES_DIR, slice, "mutations.ts")])
  .filter((file) => existsSync(file));

const configFile = ts.readConfigFile(path.join(FRONTEND_DIR, "tsconfig.json"), ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, FRONTEND_DIR);
// `incremental` off so reading the tree writes no build-info file beside it.
const program = ts.createProgram([CLIENT_MODULE, ...callerFiles, ...filterTypeFiles], {
  ...parsedConfig.options,
  incremental: false,
  noEmit: true,
});
const checker = program.getTypeChecker();

const clientFile = program.getSourceFile(CLIENT_MODULE);
const clientModule = clientFile === undefined ? undefined : checker.getSymbolAtLocation(clientFile);
// The one symbol calls are matched against. Identity, not the name: every other helper in
// `fl_frontend/src/core/api.ts` is called the same way, and a call site may rename it on import.
const clientSymbol = clientModule === undefined ? undefined : checker.getExportsOfModule(clientModule).find((s) => s.name === "apiClient");

/** One `apiClient` call as the source spells it, with the placeholder already substituted. */
type ExtractedCall = {
  where: string;
  method: string;
  segments: string[];
  sent: { name: string; source: string }[];
};

const calls: ExtractedCall[] = [];
/** Anything that could not be resolved statically. Never skipped: an unread call is an unchecked one. */
const unreadable: string[] = [];
const filterTypesUsed = new Set<string>();

function resolvesToClient(callee: ts.Identifier): boolean {
  const local = checker.getSymbolAtLocation(callee);
  if (local === undefined || clientSymbol === undefined) return false;
  // Through the import alias, so a call site renaming the client on import is still seen.
  return ((local.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(local) : local) === clientSymbol;
}

function endpointText(argument: ts.Expression): string | null {
  if (ts.isStringLiteralLike(argument)) return argument.text;
  if (ts.isTemplateExpression(argument)) {
    return argument.head.text + argument.templateSpans.map((span) => PATH_PARAM + span.literal.text).join("");
  }
  return null;
}

/** The property names a `params` argument can put on the wire, or why they could not be counted. */
function paramProperties(node: ts.Expression): { label: string; names: string[] } | string {
  const type = checker.getTypeAtLocation(node);
  const label = checker.typeToString(type);

  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return `\`params\` is ${label}, so no name can be compared`;
  if (checker.getIndexInfosOfType(type).length > 0) return `\`params\` is ${label}, whose index signature admits any name`;
  // A union reports only the names every branch shares, which would UNDER-report what is sent.
  if (type.isUnion()) return `\`params\` is ${label}, a union whose branches need not agree on names`;

  const names = type.getProperties().map((property) => property.name);
  if (names.length === 0) return `\`params\` is ${label}, which declares no property`;
  return { label: label, names: names };
}

type ReadOptions = { method: string; params: { label: string; names: string[] } | null };

function readOptions(argument: ts.Expression, where: string): ReadOptions | null {
  if (!ts.isObjectLiteralExpression(argument)) {
    unreadable.push(`${where}: the options argument is not an object literal, so its method and params cannot be read`);
    return null;
  }

  let method = "GET";
  let params: { label: string; names: string[] } | null = null;

  for (const property of argument.properties) {
    if (ts.isSpreadAssignment(property)) {
      unreadable.push(`${where}: the options argument spreads another value, so its method and params cannot be read`);
      return null;
    }
    const key =
      property.name === undefined ? null : ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (key === null) {
      unreadable.push(`${where}: an options key is computed, so what it sets cannot be read`);
      return null;
    }
    if (key !== "method" && key !== "params") continue;

    const value = ts.isPropertyAssignment(property) ? property.initializer : ts.isShorthandPropertyAssignment(property) ? property.name : null;
    if (value === null) {
      unreadable.push(`${where}: \`${key}\` is not a plain property, so it cannot be read`);
      return null;
    }

    if (key === "method") {
      if (!ts.isStringLiteralLike(value)) {
        unreadable.push(`${where}: \`method\` is not a string literal, so the operation cannot be identified`);
        return null;
      }
      method = value.text;
      continue;
    }

    const resolved = paramProperties(value);
    if (typeof resolved === "string") {
      unreadable.push(`${where}: ${resolved}`);
      return null;
    }
    params = resolved;
  }

  return { method: method, params: params };
}

for (const file of callerFiles) {
  const sourceFile = program.getSourceFile(file);
  if (sourceFile === undefined) {
    unreadable.push(`${asPosix(file)}: names apiClient but is not in the program`);
    continue;
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && resolvesToClient(node.expression)) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const where = `${asPosix(file)}:${line}`;
      const endpointArgument = node.arguments[0];
      const endpoint = endpointArgument === undefined ? null : endpointText(endpointArgument);

      if (endpoint === null) {
        unreadable.push(`${where}: the endpoint is neither a string nor a template literal, so no path can be compared`);
      } else {
        const optionsArgument = node.arguments[2];
        const options =
          optionsArgument === undefined ? ({ method: "GET", params: null } satisfies ReadOptions) : readOptions(optionsArgument, where);

        if (options !== null) {
          const [pathText = "", queryText = ""] = endpoint.split("?");
          const inline = [...new URLSearchParams(queryText).keys()].map((name) => ({ name: name, source: "the endpoint literal" }));
          const typed = (options.params?.names ?? []).map((name) => ({ name: name, source: options.params?.label ?? "" }));
          if (options.params !== null) filterTypesUsed.add(options.params.label);

          calls.push({
            where: where,
            method: options.method,
            segments: pathText.split("/").filter((segment) => segment.length > 0),
            sent: [...inline, ...typed],
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const declaredFilterTypes: { name: string; file: string }[] = [];
for (const file of filterTypeFiles) {
  for (const statement of program.getSourceFile(file)?.statements ?? []) {
    const isExported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isTypeAliasDeclaration(statement) && isExported === true && statement.name.text.endsWith("FilterParams")) {
      declaredFilterTypes.push({ name: statement.name.text, file: asPosix(file) });
    }
  }
}

describe("the published document places every path this comparison reads", () => {
  it("carries exactly one version prefix", () => {
    assert.equal(
      versionPrefixes.length,
      1,
      `expected one /api/v<n> prefix in openapi.json, found [${versionPrefixes}] — refresh it:  ${REGENERATE}`,
    );
  });

  it("publishes nothing this comparison cannot place", () => {
    assert.deepEqual(
      unplaceable,
      [],
      `Published outside ${versionPrefix} and outside the recorded exceptions [${UNVERSIONED}]: ${unplaceable}`,
    );
  });

  it("publishes operations under the prefix", () => {
    assert.ok(published.size > 0, `no operations under ${versionPrefix} in openapi.json — refresh it:  ${REGENERATE}`);
  });
});

describe("the reader sees every call site", () => {
  it("resolves the client every call is matched against", () => {
    assert.ok(
      clientSymbol,
      `fl_frontend/src/core/api.ts exports no apiClient, so nothing here matches a call. Point CLIENT_MODULE at the client instead.`,
    );
  });

  it("reads every apiClient call it finds", () => {
    assert.deepEqual(unreadable, [], `These calls could not be read statically, so nothing compares them:\n  ${unreadable.join("\n  ")}`);
  });

  it("finds a call in every queries and mutations module", () => {
    const silent = expectedCallerFiles.map(asPosix).filter((file) => !calls.some((call) => call.where.startsWith(`${file}:`)));

    assert.deepEqual(
      silent,
      [],
      `These modules exist but yielded no apiClient call, so the reader has gone blind to them:\n  ${silent.join("\n  ")}`,
    );
  });
});

describe("every request the frontend composes is published", () => {
  for (const call of calls) {
    const key = operationKey(call.method, call.segments);

    it(`${key} at ${call.where}`, () => {
      const operation = published.get(key);
      const sameResource = [...published.keys()].filter((candidate) => candidate.split("/")[1] === call.segments[0]);
      assert.ok(
        operation,
        `${call.where} calls ${key}, which the backend does not publish under ${versionPrefix}.\n` +
          `Correct the call, or add the route on the backend and refresh the document.\n` +
          `  published on this resource:\n    ${sameResource.join("\n    ")}`,
      );

      // Names only: whether a VALUE fits is the Zod mirror's comparison, in
      // `fl_frontend/src/core/apiContract.test.ts`.
      const undeclared = call.sent.filter((param) => !operation.queryParams.has(param.name));
      assert.deepEqual(
        undeclared.map((param) => `${param.name} (from ${param.source})`),
        [],
        `${call.where} sends query parameters ${operation.published} does not declare, and the server drops an unknown one in silence.\n` +
          `  declared: ${[...operation.queryParams].sort().join(", ") || "none"}`,
      );
    });
  }
});

describe("every filter type reaches an endpoint", () => {
  it("passes every declared FilterParams type to a call", () => {
    const orphaned = declaredFilterTypes.filter((type) => !filterTypesUsed.has(type.name)).map((type) => `${type.name} (${type.file})`);

    assert.deepEqual(
      orphaned,
      [],
      `These filter types are declared but reach no apiClient call, so nothing compares their names against a published parameter:\n  ${orphaned.join("\n  ")}`,
    );
  });
});
