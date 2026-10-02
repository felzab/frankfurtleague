import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { judgeAtProcessEnd } from "./verdicts.ts";

/**
 * The words a module cannot bind: ECMAScript's reserved words, the ones strict mode adds, and `await`,
 * which a module reserves. Refused before the source is built, since a module declaring one fails to
 * link with a SyntaxError naming no double.
 */
export const UNBINDABLE: ReadonlySet<string> = new Set([
  ...["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum"],
  ...["export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null"],
  ...["return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with"],
  ...["implements", "interface", "let", "package", "private", "protected", "public", "static", "yield"],
  ...["await", "eval", "arguments"],
]);

/**
 * A name a generated module declares, spelled into its source where no literal can hold it: refused
 * unless it is an identifier a module may bind, so nothing read off a real module can write code into
 * the double.
 */
function identifier(name: string): string {
  // Unicode's identifier classes, which ECMAScript names hold to, so a letter outside ASCII binds as the engine binds it.
  if (!/^[\p{ID_Start}$_][\p{ID_Continue}$]*$/u.test(name) || UNBINDABLE.has(name)) {
    throw new Error(`${JSON.stringify(name)} is no name a module can declare`);
  }
  return name;
}

let modulesBuilt = 0;

/**
 * Each value crosses through a global and never as a literal in the source, which spells identifiers
 * alone: a value written into code is safe only while every escape it passed through holds.
 */
export function exportingModule(values: Readonly<Record<string, unknown>>): string {
  // A slot per module, since two modules can load before either evaluates.
  const slot = `__flDoubledModule${String((modulesBuilt += 1))}`;
  Reflect.set(globalThis, slot, values);
  return `export const { ${Object.keys(values).map(identifier).join(", ")} } = globalThis.${slot};`;
}

/** A real module's namespace, as a module standing over it hands it to the overrides it builds. */
export type RealModule = Readonly<Record<string, unknown>>;

const REAL_MODULES = new Map<string, string>();

/** Asks for a package as the tree installs it, whatever double a suite resolves its own name to. */
const INSTALLED = "fl-installed-package:";

// Registered as this module evaluates: a hook registered from inside another's load would change the
// chain that load is running in.
registerHooks({
  resolve(specifier, context, nextResolve) {
    // Passed on below every suite's hook, each registered after this one and so asked before it.
    if (specifier.startsWith(INSTALLED)) return nextResolve(specifier.slice(INSTALLED.length), context);
    const real = REAL_MODULES.get(specifier);
    return real === undefined ? nextResolve(specifier, context) : { url: real, shortCircuit: true };
  },
});

/**
 * A module standing over the real one at `realUrl`: every export the real module has, but those
 * `overrides` names, each built from the real module's own namespace once it has evaluated.
 */
export function overridingModule(realUrl: string, overrides: Readonly<Record<string, (real: RealModule) => unknown>>): string {
  // Answered by the hook above, so the real module's URL is never written into the source.
  const specifier = `fl-real-module:${String(REAL_MODULES.size + 1)}`;
  REAL_MODULES.set(specifier, realUrl);
  const slot = `__flDoubledModule${String((modulesBuilt += 1))}`;
  Reflect.set(globalThis, slot, (real: RealModule) =>
    Object.fromEntries(Object.entries(overrides).map(([name, build]) => [name, build(real)])),
  );
  return [
    `import * as real from "${specifier}";`,
    `export * from "${specifier}";`,
    `export const { ${Object.keys(overrides).map(identifier).join(", ")} } = globalThis.${slot}(real);`,
  ].join("\n");
}

const isMarked = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind);

const boundBy = (name: ts.BindingName): string[] =>
  ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((element) => (ts.isOmittedExpression(element) ? [] : boundBy(element.name)));

/** The run-time names one top-level statement of `file` exports. */
function exportedBy(statement: ts.Statement, file: string): string[] {
  if (ts.isExportDeclaration(statement)) {
    if (statement.isTypeOnly) return [];
    // Loud rather than empty: the names are another module's, and a double missing them fails to link.
    if (statement.exportClause === undefined) throw new Error(`${file} re-exports a whole module, whose names this reader does not follow`);
    if (ts.isNamespaceExport(statement.exportClause)) return [statement.exportClause.name.text];
    return statement.exportClause.elements.filter((element) => !element.isTypeOnly).map((element) => element.name.text);
  }
  if (ts.isExportAssignment(statement)) return ["default"];
  if (!isMarked(statement, ts.SyntaxKind.ExportKeyword) || isMarked(statement, ts.SyntaxKind.DeclareKeyword)) return [];
  if (isMarked(statement, ts.SyntaxKind.DefaultKeyword)) return ["default"];
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => boundBy(declaration.name));
  if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
    return statement.name === undefined ? [] : [statement.name.text];
  }
  // A namespace binds at run time unless it holds types alone, which only a checker can tell.
  if (ts.isModuleDeclaration(statement)) throw new Error(`${file} exports a namespace, whose names this reader does not follow`);
  return [];
}

/**
 * Every name the module at `file` exports at run time, read off TypeScript's syntax tree: a pattern
 * over the text reads names out of comments, cuts one at an umlaut, and misses shapes it does not spell.
 */
export function exportedNames(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false);
  return [...new Set(source.statements.flatMap((statement) => exportedBy(statement, file)))];
}

/**
 * Stands in for the real module at `realUrl` without evaluating it, exporting every name it has: a
 * double listing names by hand fails its whole suite with a SyntaxError the day the code under test
 * imports one more.
 */
export function replacingModule(realUrl: string, what: string, doubled: Readonly<Record<string, unknown>>): string {
  return standingIn(exportedNames(fileURLToPath(realUrl)), what, doubled);
}

const requireHere = createRequire(import.meta.url);

/**
 * `replacingModule` for an installed package, its names read off the package evaluated rather than
 * parsed: Next's entry files are CommonJS, which assign their exports at run time.
 */
export function replacingPackage(specifier: string, doubled: Readonly<Record<string, unknown>>): string {
  const installed = requireHere(requireHere.resolve(`${INSTALLED}${specifier}`)) as Readonly<Record<string, unknown>>;
  // `exportingModule` binds names alone, so a default import of a doubled package fails to link.
  return standingIn(
    Object.keys(installed).filter((name) => name !== "default"),
    specifier,
    doubled,
  );
}

function standingIn(names: readonly string[], what: string, doubled: Readonly<Record<string, unknown>>): string {
  const notDoubled = (name: string) => (): never => {
    throw new Error(`${what}'s ${name} is not doubled`);
  };

  return exportingModule(Object.fromEntries(names.map((name) => [name, Object.hasOwn(doubled, name) ? doubled[name] : notDoubled(name)])));
}

/** A module's source as a URL a resolve hook can answer with. */
export const asDataUrl = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

/** The exports a double answers for, by name: every other name the real module has throws once called. */
export type DoubledExports = Readonly<Record<string, unknown>>;

/** What `registerDoubles` stands in for the modules and packages a suite loads. */
export type Doubles = {
  /** By the module's path under `fl_frontend/src/`, such as `core/config.ts`: its doubled exports, or the source standing in its place. */
  readonly modules?: Readonly<Record<string, DoubledExports | string>>;
  /** By the specifier an import spells, a bare one or an alias: the package's doubled exports, the source standing in its place, or the module at a URL. */
  readonly specifiers?: Readonly<Record<string, DoubledExports | string | URL>>;
};

/** How `registerDoubles` judges the doubles it registers. */
export type Registration = {
  /**
   * For a helper standing one set under every suite of a kind, whose subjects each reach part of it:
   * a double no subject reaches then fails nothing. A suite's own doubles never take it.
   */
  readonly mayGoUnserved?: boolean;
};

const SOURCE_ROOT = new URL("../", import.meta.url);

/**
 * Registers the doubles a suite then imports its subject under, which it does with a dynamic import:
 * a static one resolves before the hooks exist. `server-only` always loads empty, its real module
 * throwing outside a React server build.
 */
export function registerDoubles({ modules = {}, specifiers = {} }: Doubles = {}, { mayGoUnserved = false }: Registration = {}): void {
  // A path naming no module would double nothing, and the suite would run against the real one.
  const missing = Object.keys(modules).filter((at) => !existsSync(new URL(at, SOURCE_ROOT)));
  if (missing.length > 0) throw new Error(`No module under fl_frontend/src at ${missing.join(", ")}`);
  // Nor may one name a module the subject never loads, or loads past the match below: the suite would
  // believe it doubled what it never reached. Judged at the process's end, after every case's imports.
  const unserved = new Set(mayGoUnserved ? [] : [...Object.keys(modules), ...Object.keys(specifiers)]);
  if (unserved.size > 0) {
    judgeAtProcessEnd(() => assert.deepEqual([...unserved], [], "these doubles were registered and never served: drop each, or reach it"));
  }
  // Built here, each export name read off the installed package before any hook below stands over it.
  const replaced = new Map(
    Object.entries(specifiers).map(([specifier, double]) => [
      specifier,
      double instanceof URL ? double.href : asDataUrl(typeof double === "string" ? double : replacingPackage(specifier, double)),
    ]),
  );
  const doubled = Object.entries(modules);

  registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = replaced.get(specifier);
      if (url !== undefined) {
        unserved.delete(specifier);
        return { url: url, shortCircuit: true };
      }
      // The empty build its `react-server` condition names, rather than a `data:` module: Next's own
      // CommonJS `require` of one reads the URL as a path.
      if (specifier === "server-only") return nextResolve(specifier, { ...context, conditions: [...context.conditions, "react-server"] });
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      // Matched on the RESOLVED url's end, so this holds whichever order the alias hook and this one
      // run in, and a query-suffixed url passes: the db-tier suites load the real `db.ts` that way.
      const found = doubled.find(([at]) => url.endsWith(`/src/${at}`));
      if (found === undefined) return nextLoad(url, context);
      const [at, double] = found;
      unserved.delete(at);
      const source = typeof double === "string" ? double : replacingModule(url, at, double);
      return { format: "module", source: source, shortCircuit: true };
    },
  });
}

/**
 * Stands every component module whose resolved url `pattern` matches in for one whose component,
 * named by the file, renders nothing: for a suite reading what a page hands its views, or its metadata.
 */
export function registerRenderingNothing(pattern: RegExp): void {
  registerHooks({
    load(url, context, nextLoad) {
      if (!pattern.test(url)) return nextLoad(url, context);
      const component = path.basename(fileURLToPath(url)).replace(/\.\w+$/, "");
      return { format: "module", source: replacingModule(url, component, { [component]: () => null }), shortCircuit: true };
    },
  });
}
