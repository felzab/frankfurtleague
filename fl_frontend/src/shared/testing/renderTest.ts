import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import type { ComponentType, ReactNode } from "react";
import type * as TypeScript from "typescript";

const requireHere = createRequire(import.meta.url);

const CACHE_DIR = path.resolve(import.meta.dirname, "..", "..", "..", "node_modules", ".cache", "render-test");

/*
 Everything a compiled component depends on beyond its own path and text: this file, which holds the
 compiler options, and the installed compiler. Read as bytes, so no entry outlives a change to either.
*/
const CACHE_SALT = [
  createHash("sha256")
    .update(readFileSync(import.meta.filename))
    .digest("hex"),
  createHash("sha256")
    .update(readFileSync(requireHere.resolve("typescript")))
    .digest("hex"),
];

let compiler: typeof TypeScript | undefined;

function transpile(filename: string, source: string): string {
  // Required on the first miss rather than imported: a process whose every component is cached never
  // pays for loading the compiler.
  const ts = (compiler ??= requireHere("typescript") as typeof TypeScript);

  return ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      // Without it a stack trace names the `.tsx` at lines of the transpiled output, which that file does not hold.
      inlineSourceMap: true,
      inlineSources: true,
    },
  }).outputText;
}

function compiled(filename: string): string {
  const source = readFileSync(filename, "utf8");
  const key = createHash("sha256")
    .update(JSON.stringify([...CACHE_SALT, filename, source]))
    .digest("hex");
  const entry = path.join(CACHE_DIR, `${key}.js`);

  try {
    return readFileSync(entry, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const output = transpile(filename, source);
  // Written aside and renamed in: every test file's process reads this directory at once, and none may
  // read half an entry.
  const temp = `${entry}.${String(process.pid)}.tmp`;
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(temp, output);
    renameSync(temp, entry);
  } catch {
    // The output is returned either way, and a rename refused over an entry another process holds
    // open leaves the same bytes in place.
    rmSync(temp, { force: true });
  }

  return output;
}

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

/** The faces `fl_frontend/src/app/layout.tsx` loads; one it adds fails to link here until it is named. */
const INERT_FONTS = `data:text/javascript,${encodeURIComponent(`const face = () => ({ className: "", variable: "", style: { fontFamily: "" } });
export { face as Anton, face as Inter, face as Raleway };`)}`;

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

    // Next's font loader runs only inside its own build, so each face loads as an inert one, as a
    // stylesheet does below: nothing a render here asserts is decided by a font.
    if (specifier === "next/font/google") return { url: INERT_FONTS, shortCircuit: true };

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

    return { format: "module", shortCircuit: true, source: compiled(fileURLToPath(url)) };
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

/**
 * The words inside markup, each tag replaced by `separator`. The empty default joins what stood either
 * side of a tag; a caller reading across an element boundary passes a space, or two words become one.
 */
export function textOf(html: string, separator = ""): string {
  let text = html;

  // To a FIXPOINT rather than in one pass — the shape CodeQL's
  // incomplete-multi-character-sanitization names: a pattern leaving a tag standing hands the caller
  // markup to read as text, and this one is free to change.
  for (let previous = ""; text !== previous;) {
    previous = text;
    text = text.replace(/<[^>]*>/g, separator);
  }

  return text;
}

export type RefusalWrapper = {
  /** What the overlay, the one tab stop, is named. */
  name: string;
  /** The closed control's own accessible name: its `aria-label` where it carries one, and its words where it does not. */
  label: string;
  reason: string;
};

const attributeOf = (tag: string, name: string): string | null => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

function closingDiv(html: string, from: number): number {
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = from;

  for (let depth = 1, tag = tags.exec(html); tag !== null; tag = tags.exec(html)) {
    depth += tag[0] === "</div>" ? -1 : 1;
    if (depth === 0) return tag.index;
  }

  return html.length;
}

/** The markup inside the `inert` box standing immediately before `at`, which is where the overlay covers its control. */
function coveredBefore(html: string, at: number): string | null {
  const boxes = [...html.slice(0, at).matchAll(/<div\b[^>]*>/g)].filter((opening) => attributeOf(opening[0], "inert") !== null);

  for (const box of boxes.toReversed()) {
    const start = box.index + box[0].length;
    const end = closingDiv(html, start);
    if (end + "</div>".length === at) return html.slice(start, end);
  }

  return null;
}

/**
 * The control an `inert` box holds, where it is closed: a disabled button, or a link with no `href` to follow. An open
 * control under the overlay is a closure announced over a control that works, and no refusal.
 */
function closedControl(covered: string): { attributes: string; inner: string } | null {
  const control = /<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/.exec(covered);
  if (control === null) return null;

  const attributes = control[2] ?? "";
  const isClosed = control[1] === "button" ? attributeOf(attributes, "disabled") !== null : attributeOf(attributes, "href") === null;

  return isClosed ? { attributes, inner: control[3] ?? "" } : null;
}

/**
 * Every refusal `fl_frontend/src/shared/components/ui/Hint.tsx :: RefusalHint` renders, in document order, from
 * either renderer's markup. Both halves of the closure decide it: a heading's reveal hint is a popover trigger too,
 * and announces nothing closed.
 */
export function refusalWrappers(html: string): RefusalWrapper[] {
  return [...html.matchAll(/<div\b[^>]*>/g)].flatMap((opening) => {
    const tag = opening[0];
    if (attributeOf(tag, "data-slot") !== "popover-trigger" || attributeOf(tag, "aria-disabled") !== "true") return [];

    const covered = coveredBefore(html, opening.index);
    const control = covered === null ? null : closedControl(covered);
    if (control === null) return [];

    const describedBy = attributeOf(tag, "aria-describedby") ?? "";
    const literal = describedBy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const description = new RegExp(`<(\\w+)\\b([^>]*\\sid="${literal}"[^>]*)>([\\s\\S]*?)</\\1>`).exec(html);
    const words = textOf(control.inner, " ").replace(/\s+/g, " ").trim();
    const name = attributeOf(tag, "aria-label") ?? "";

    // Refused here rather than left to each panel test: speech input finds the one tab stop by the words on screen
    // (WCAG 2.5.3), and every panel test reads its refusals through this reader. An icon-only control has no words.
    if (!name.includes(words))
      throw new Error(`a refusal named „${name}“ covers a control reading „${words}“, which its name does not contain`);

    return [
      {
        name,
        label: attributeOf(control.attributes, "aria-label") ?? words,
        // Read only where the description is hidden: a reason standing in the flow is the defect the overlay exists against.
        reason: description !== null && attributeOf(description[2] ?? "", "hidden") !== null ? textOf(description[3] ?? "") : "",
      },
    ];
  });
}
