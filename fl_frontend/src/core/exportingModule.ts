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
