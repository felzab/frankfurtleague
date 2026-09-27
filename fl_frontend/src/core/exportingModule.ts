import { registerHooks } from "node:module";

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
  if (!/^[A-Za-z_$][\w$]*$/.test(name) || UNBINDABLE.has(name)) throw new Error(`${JSON.stringify(name)} is no name a module can declare`);
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
