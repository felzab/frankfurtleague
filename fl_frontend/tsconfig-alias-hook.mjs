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

    const base = path.join(SRC_DIR, specifier.slice(ALIAS.length));
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = base + suffix;
      if (isFile(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }

    // Fall through rather than throw, so an unresolvable alias reports Node's own error naming the
    // original specifier instead of a rewritten path nobody wrote.
    return nextResolve(specifier, context);
  },
});
