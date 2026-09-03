import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import type { ComponentType, ReactNode } from "react";

/**
 * Narrow on purpose. `tsconfig-alias-hook.mjs` throws a plain `Error` naming every path an
 * unresolvable `@/…` was tried at, and a retry would replace that with the same failure spelled one
 * suffix longer.
 */
function isMissingModule(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND";
}

/**
 * A bare `react` resolves through its own manifest, so retrying it as `react.js` reports a package
 * name nobody wrote in place of the uninstalled dependency or the typo that was really there.
 */
function isPathLike(specifier: string): boolean {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return true;

  return specifier.split("/").length > (specifier.startsWith("@") ? 2 : 1);
}

/*
 Registered as this module evaluates, which is why a component under test is reached with
 `await import` and never a static import beside this one (`docs/frontend/spec.md` §1.9).
*/
registerHooks({
  resolve(specifier, context, nextResolve) {
    // `server-only` throws under the `default` condition and is empty under `react-server`, which a
    // server render is. Taken for this one specifier: React's own `react-server` build has no client
    // hooks, so every component would lose `useState`.
    if (specifier === "server-only") {
      return nextResolve(specifier, { ...context, conditions: [...context.conditions, "react-server"] });
    }

    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // `next` publishes no `exports` map, and several ESM dependencies import `./x` bare. A bundler
      // supplies the extension for both; Node supplies it for neither.
      if (!isMissingModule(error) || !isPathLike(specifier) || path.extname(specifier) !== "") throw error;

      return nextResolve(`${specifier}.js`, context);
    }
  },

  load(url, context, nextLoad) {
    // Every stylesheet here is imported for its side effect alone, so nothing can read a name back
    // off one. A CSS Module would, and would need more than this.
    if (url.endsWith(".css")) return { format: "module", shortCircuit: true, source: "" };

    // Node strips types and compiles no JSX, which leaves `.tsx` the one kind it cannot load unaided.
    if (!url.endsWith(".tsx")) return nextLoad(url, context);

    const filename = fileURLToPath(url);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        // Without it a stack trace names lines of the transpiled output, which no file on disk holds.
        inlineSourceMap: true,
        inlineSources: true,
      },
    });

    return { format: "module", shortCircuit: true, source: compiled.outputText };
  },
});

/** The markup a browser is served, which `renderToStaticMarkup` produces with no DOM to render into. */
export function renderMarkup<P extends object>(Component: ComponentType<P>, props: P): string {
  return renderToStaticMarkup(createElement(Component, props));
}

/**
 * For what props cannot express — a component under the provider it reads, or one asserted beside a
 * sibling whose ordering is the claim.
 */
export function renderTree(tree: ReactNode): string {
  return renderToStaticMarkup(tree);
}
