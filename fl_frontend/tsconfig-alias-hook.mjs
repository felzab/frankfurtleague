/**
 * Teaches `node --test` the `@/*` path alias from tsconfig.json.
 *
 * Node's ESM resolver reads neither `tsconfig` paths nor extensionless specifiers, so without this a
 * module under test that imports `@/shared/utils/format` dies with ERR_MODULE_NOT_FOUND — even though
 * `tsc` and Turbopack both resolve it fine. The workaround before this existed was to write the import
 * relatively and with an explicit `.ts` extension, which put a rule in the codebase that applied to
 * exactly one file and would have confused the next person to add a test.
 *
 * Wired into the `test` script via `--import`. It affects nothing else: `next build`, `tsc` and ESLint
 * never load it.
 *
 * NOT named `test-alias-loader.mjs`, which is what it was called first: `node --test` discovers
 * `test-*` as a test file, so it was collected, executed a second time, and inflated the test count
 * by one. Keep the name clear of `test-*`, `*.test.*`, `*-test.*` and `*_test.*`.
 *
 * `registerHooks` (Node >= 22.15) runs the hook synchronously and in-thread, so this needs no separate
 * hooks module and no deprecated `--loader` flag.
 *
 * Test files themselves keep their ordinary relative imports (`./format.ts`) — those are plain ESM and
 * correct as written. This exists only so *application* modules can use the alias everywhere.
 */
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SRC_DIR = path.join(import.meta.dirname, "src");
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

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(ALIAS)) return nextResolve(specifier, context);

    // No containment check against SRC_DIR on purpose: `@/../package.json` resolving outside src/
    // is exactly what tsconfig's `paths` substitution does, and this hook exists to mirror tsconfig.
    // Rejecting it here would make the two disagree, which is worse than allowing a path nobody
    // writes.
    const base = path.join(SRC_DIR, specifier.slice(ALIAS.length));
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = base + suffix;
      if (isFile(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }

    // Throw rather than fall through. Node's own error for an unresolved "@/..." is
    // `Cannot find package '@/shared'`, which sends the reader looking for a missing dependency --
    // the one thing it is not. Name the specifier, where it was imported from, and what was tried.
    const tried = CANDIDATE_SUFFIXES.map((suffix) => path.relative(import.meta.dirname, base + suffix)).join(", ");
    throw new Error(
      `Cannot resolve "${specifier}"` +
        (context.parentURL ? ` imported from ${context.parentURL}` : "") +
        `\n  The "@/*" alias maps to src/*. None of these files exist: ${tried}` +
        `\n  (resolved by tsconfig-alias-hook.mjs, which teaches \`node --test\` the tsconfig path alias)`,
    );
  },
});
