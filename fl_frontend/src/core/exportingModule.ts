import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

import ts from "typescript";

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

// Registered as this module evaluates: a hook registered from inside another's load would change the
// chain that load is running in.
registerHooks({
  resolve(specifier, context, nextResolve) {
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
 * over its text reads a name out of a comment, stops at a letter outside ASCII, and misses a
 * declaration of a shape it does not spell.
 */
export function exportedNames(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false);
  return [...new Set(source.statements.flatMap((statement) => exportedBy(statement, file)))];
}

/**
 * A module standing in for the real one at `realUrl` without evaluating it: every export the real
 * module has, `doubled` answering for those it names and every other throwing where called. A name
 * the code under test starts importing then links, where a double listing names by hand fails its
 * whole suite with a SyntaxError.
 */
export function replacingModule(realUrl: string, what: string, doubled: Readonly<Record<string, unknown>>): string {
  const notDoubled = (name: string) => (): never => {
    throw new Error(`${what}'s ${name} is not doubled`);
  };

  return exportingModule(
    Object.fromEntries(
      exportedNames(fileURLToPath(realUrl)).map((name) => [name, Object.hasOwn(doubled, name) ? doubled[name] : notDoubled(name)]),
    ),
  );
}
