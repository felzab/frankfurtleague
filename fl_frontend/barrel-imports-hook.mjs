import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The build's own list, read rather than copied, so a package joining or leaving it is narrowed or not
// here as it is in the bundle.
const CONFIG = path.join(import.meta.dirname, "next.config.ts");
const configText = readFileSync(CONFIG, "utf8");
const listed = /optimizePackageImports:\s*\[([^\]]*)\]/.exec(configText);
// Thrown rather than narrowing nothing: a list this cannot read would only cost time, which nobody sees.
if (listed === null && configText.includes("optimizePackageImports")) {
  throw new Error(`barrel-imports-hook.mjs cannot read the optimizePackageImports list in ${CONFIG}`);
}
const PACKAGES = new Set(listed === null ? [] : [...listed[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const barrels = new Map();

/** Null unless every line is an `export { … } from "…"`: a barrel doing anything else is loaded whole. */
function barrelOf(url) {
  if (barrels.has(url)) return barrels.get(url);
  const exports = new Map();
  let barrel = { exports };
  const source = readFileSync(fileURLToPath(url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("//") || line === '"use strict";') continue;
    const reExport = /^export\s*\{([^}]*)\}\s*from\s*(['"][^'"]+['"]);?$/.exec(line);
    if (reExport === null) {
      barrel = null;
      break;
    }
    for (const part of reExport[1].split(",")) {
      const [imported, exported = imported] = part.trim().split(/\s+as\s+/);
      // The barrel's own specifier, spelled as it spells it: completing one here would load what the
      // barrel itself could not.
      if (imported) exports.set(exported, [reExport[2], imported]);
    }
  }
  barrels.set(url, barrel);
  return barrel;
}

/** The name a specifier imports, or null where the entry is anything but `[type ]name[ as alias]`. */
function importedName(entry) {
  const name = entry.replace(/^type\s+/, "").replace(/\s+as\s+[A-Za-z_$][\w$]*$/, "");
  return IDENTIFIER.test(name) ? name : null;
}

/**
 * Null where any mention of `pkg` is not a quoted literal read as a named import or a destructured
 * `await import` whose every entry is an identifier: that module gets the whole barrel rather than a
 * guess.
 */
function namesTaken(parentURL, pkg) {
  const source = readFileSync(fileURLToPath(parentURL), "utf8");
  const quoted = `["']${escapeRegExp(pkg)}["']`;
  const mentions = source.match(new RegExp(quoted, "g"))?.length ?? 0;
  // A specifier this cannot see, a template literal or an escaped string, resolved all the same.
  if (mentions === 0) return null;
  const names = [];
  let read = 0;
  for (const match of source.matchAll(new RegExp(`import\\s+(type\\s+)?\\{([^}]*)\\}\\s*from\\s*${quoted}`, "g"))) {
    read += 1;
    for (const part of match[2].split(",")) {
      const entry = part.trim();
      if (entry === "") continue;
      const name = importedName(entry);
      if (name === null) return null;
      if (!match[1] && !entry.startsWith("type ")) names.push(name);
    }
  }
  for (const match of source.matchAll(new RegExp(`\\{([^}]*)\\}\\s*=\\s*await\\s+import\\(\\s*${quoted}\\s*\\)`, "g"))) {
    read += 1;
    for (const part of match[1].split(",")) {
      const entry = part.trim();
      if (entry === "") continue;
      const [name, alias, ...rest] = entry.split(":").map((side) => side.trim());
      if (!IDENTIFIER.test(name) || (alias !== undefined && !IDENTIFIER.test(alias)) || rest.length > 0) return null;
      names.push(name);
    }
  }
  return read === mentions ? names : null;
}

const narrowed = new Map();

// Otherwise every rendering test file's process loads each barrel whole for the few names it takes,
// which the bundle never does: 26 percent of a rendering test process's CPU without this hook, on
// the sixteen-core Windows machine (measured 2026-09-22).
registerHooks({
  resolve(specifier, context, nextResolve) {
    const resolved = nextResolve(specifier, context);
    const parent = context.parentURL;
    if (
      !PACKAGES.has(specifier) ||
      !context.conditions.includes("import") ||
      !parent?.startsWith("file:") ||
      parent.includes("/node_modules/")
    ) {
      return resolved;
    }
    const names = namesTaken(parent, specifier);
    if (names === null) return resolved;
    const barrel = barrelOf(resolved.url);
    if (barrel === null) return resolved;
    // Dropped only where the whole barrel answers the same: an importer asking for a name it does not
    // export fails to link there too, and a name the compiler erased as a type is never asked for.
    const kept = [...new Set(names.filter((name) => barrel.exports.has(name)))].sort();
    // Beside the barrel, so each of its relative specifiers resolves from where the barrel's would.
    const url = `${resolved.url}?only=${kept.join(",")}`;
    if (!narrowed.has(url)) {
      const lines = kept.map((name) => {
        const [target, imported] = barrel.exports.get(name);
        return `export { ${imported} as ${name} } from ${target};`;
      });
      narrowed.set(url, lines.join("\n"));
    }
    return { url, format: "module", shortCircuit: true };
  },

  load(url, context, nextLoad) {
    const source = narrowed.get(url);
    return source === undefined ? nextLoad(url, context) : { format: "module", source, shortCircuit: true };
  },
});
