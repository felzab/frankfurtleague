import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");
const APP_DIR = path.join(SRC_DIR, "app");

/** The seam itself, held apart below so its own declaration is never read as a call to it. */
const SEAM = path.join(SRC_DIR, "shared", "hooks", "useReportClientCrash.ts");

/** The route the report is posted to, by the path the file convention serves it at. */
const INGEST = path.join(APP_DIR, "api", "client-error", "route.ts");

const SOURCES = new Map<string, string>();

function sourceOf(file: string): string {
  const held = SOURCES.get(file);
  if (held !== undefined) return held;

  const read = readFileSync(file, "utf8");
  SOURCES.set(file, read);

  return read;
}

const shown = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join("/");

function resolveInTree(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC_DIR, specifier.slice("@/".length))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;

  if (base === null) return null;

  return [`${base}.ts`, `${base}.tsx`, base].find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate)) ?? null;
}

/** An in-tree specifier resolving to nothing FAILS rather than being passed over, a module this reader cannot open being one it cannot clear. */
function importsOf(file: string): string[] {
  return [...sourceOf(file).matchAll(/from "([^"]+)"/g)]
    .map(([, specifier]) => specifier ?? "")
    .filter((specifier) => specifier.startsWith("@/") || specifier.startsWith("."))
    .map((specifier) => {
      const target = resolveInTree(file, specifier);
      assert.ok(target !== null, `${shown(file)} imports ${specifier}, which resolves to no module this sweep can read`);

      return target;
    });
}

/** The import binds the name and only a call spends it, so the parenthesis is what parts a reporter from an importer. */
const reports = (file: string): boolean => file !== SEAM && sourceOf(file).includes("useReportClientCrash(");

/* Next's own file convention decides this listing, so a segment given a boundary tomorrow is swept
   with no edit here. `global-error.tsx` too: it replaces the root boundary rather than joining it. */
const BOUNDARIES = filesUnder(APP_DIR, (name) => name === "error.tsx" || name === "global-error.tsx", 3);

/* One hop and no further: a boundary either calls the hook itself or hands the segment to a panel
   that does, so a report reached through a chain is reported as no report at all. */
const reportingByBoundary = new Set<string>();
const silent: string[] = [];

for (const boundary of BOUNDARIES) {
  const reached = [boundary, ...importsOf(boundary)].filter(reports);

  if (reached.length === 0) silent.push(path.relative(APP_DIR, boundary).split(path.sep).join("/"));
  for (const file of reached) reportingByBoundary.add(file);
}

const isSweptSource = (name: string) => /\.tsx?$/.test(name) && !isTestFile(name);

/* The same listing reached off the tree instead of off the boundaries, which is what leaves either
   one able to fail (`docs/_standard/standard.md :: PRE-4`). */
const reportingByTree = filesUnder(SRC_DIR, isSweptSource, 450).filter(reports);

describe("the crash report every error boundary stands behind", () => {
  /* The failure this roster exists for is silent by construction: a boundary reporting nothing
     leaves no line to miss, and the segments render no component in common to hold instead. */
  it("is reached from every boundary the app tree holds", () => {
    assert.deepEqual(
      silent,
      [],
      `${silent.join(", ")}: renders a segment's crash and reports none of it, so the crash reaches the browser's console and nothing else`,
    );
  });

  it("reaches the same reporting modules by walking the boundaries and by walking the tree", () => {
    const named = (files: Iterable<string>) => [...files].map(shown).sort();

    assert.deepEqual(named(reportingByBoundary), named(reportingByTree));
  });

  /* The hook posting to a path Next serves nothing at answers 404 and swallows it: the `catch`
     that keeps a failed report from crashing the boundary again also hides this. */
  it("lands on a route this app serves", () => {
    assert.ok(existsSync(SEAM), `${shown(SEAM)} is gone, and every boundary below was cleared against a seam this reader never opened`);
    assert.ok(existsSync(INGEST), `the app serves no ${shown(INGEST)} for the report to reach`);
    assert.match(sourceOf(SEAM), /fetch\("\/api\/client-error"/, "the seam posts somewhere other than the route that writes the log line");
  });
});
