// Loaded by `--import` in `package.json`'s `test:base` and `environment-names` scripts, the second
// running in the image's builder; `next build`, `tsc` and ESLint never load it.

// Named clear of `test-*`, `*.test.*`, `*-test.*` and `*_test.*`: `node --test` collects a file so
// named as a test and runs it a second time.
import { statSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FRONTEND_DIR = path.join(import.meta.dirname, "..");
const SRC_DIR = path.join(FRONTEND_DIR, "src");
const ALIAS = "@/";

/** tsconfig maps `@/*` to `./src/*`; TypeScript then resolves the extension, so we do the same. */
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

function isFile(candidate) {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveWithSuffix(base) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (isFile(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }
  return null;
}

/**
 * An extensionless `./x` or `../y/x`, which TypeScript resolves and Node does not.
 *
 * A specifier that already carries an extension is left alone, so a test file importing
 * `./schemas.ts` keeps resolving through Node's own resolver rather than through this.
 */
function isExtensionlessRelative(specifier) {
  return (specifier.startsWith("./") || specifier.startsWith("../")) && path.extname(specifier) === "";
}

/**
 * Never under `node_modules`: every candidate but the bare path is TypeScript, which Node will not
 * strip there, and the bare path matched none of 2256 package imports tried (measured 2026-09-22),
 * each paying a failed `stat` per candidate.
 */
function isApplicationModule(parentURL) {
  return parentURL?.startsWith("file:") === true && !parentURL.includes("/node_modules/");
}

// Found once, here: a `require.resolve` inside the hook below would re-enter it.
const NEXT_DIR = path.dirname(createRequire(import.meta.url).resolve("next/package.json"));

/**
 * `next` publishes no `exports` map, so Node's ESM resolver takes `next/server` only as the file a
 * bundler finds, `next/server.js`. A library imports these bare too, so its parent is not asked.
 */
function isNextEntry(specifier) {
  return /^next\/[\w-]+$/.test(specifier) && isFile(path.join(NEXT_DIR, `${specifier.slice("next/".length)}.js`));
}

// Node reads neither tsconfig's `@/*` paths nor an extensionless specifier, both of which `tsc` and
// Turbopack resolve, so a module written with either dies under `node --test` with
// ERR_MODULE_NOT_FOUND unless this hook answers it.

// `registerHooks` runs the hook synchronously and in-thread, so this needs no separate hooks module
// and no `--loader` flag.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (isNextEntry(specifier)) return nextResolve(`${specifier}.js`, context);

    if (isExtensionlessRelative(specifier) && isApplicationModule(context.parentURL)) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
      // Fall THROUGH rather than throw when nothing matches: an extensionless relative specifier that
      // this cannot resolve is an ordinary missing module, and Node's own error names it better.
      return resolveWithSuffix(base) ?? nextResolve(specifier, context);
    }

    if (!specifier.startsWith(ALIAS)) return nextResolve(specifier, context);

    // No containment check against SRC_DIR, deliberately: `@/../package.json` resolving outside
    // src/ is what tsconfig's `paths` substitution does, and this hook mirrors tsconfig. Rejecting
    // it would make the two disagree.
    const base = path.join(SRC_DIR, specifier.slice(ALIAS.length));
    const resolved = resolveWithSuffix(base);
    if (resolved) return resolved;

    // Throw rather than fall through: Node's own error for an unresolved `@/…` is
    // `Cannot find package '@/shared'`, which sends the reader hunting a missing dependency — the
    // one thing it is not.
    const tried = CANDIDATE_SUFFIXES.map((suffix) => path.relative(FRONTEND_DIR, base + suffix)).join(", ");
    throw new Error(
      `Cannot resolve "${specifier}"` +
        (context.parentURL ? ` imported from ${context.parentURL}` : "") +
        `\n  The "@/*" alias maps to src/*. None of these files exist: ${tried}` +
        `\n  (resolved by scripts/tsconfig-alias-hook.mjs, which teaches \`node --test\` the tsconfig path alias)`,
    );
  },
});
