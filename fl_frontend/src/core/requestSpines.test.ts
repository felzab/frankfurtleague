import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "./treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");
const APP_DIR = path.join(SRC_DIR, "app");

/** The guard's first line, whole: a module carrying this is one of the sites the rules below reach. */
const KOPF = 'const secFetchSite = request.headers.get("sec-fetch-site");';

/** `null` passes deliberately: a browser too old to send the header is still a reader of this page. */
const BEDINGUNG = 'secFetchSite !== null && secFetchSite !== "same-origin"';

/* An OAuth callback arrives cross-site by construction and Auth.js brings its own CSRF token, so
   this guard would refuse the one request this handler exists to take. */
const UNGUARDED_BY_DECISION = [path.join("api", "auth", "[...nextauth]", "route.ts")];

const SOURCES = new Map<string, string>();

function sourceOf(file: string): string {
  const held = SOURCES.get(file);
  if (held !== undefined) return held;

  const read = readFileSync(file, "utf8");
  SOURCES.set(file, read);

  return read;
}

/** Where one import specifier lands inside this tree, or `null` where it names a package. */
function resolveInTree(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(SRC_DIR, specifier.slice("@/".length))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;

  if (base === null) return null;

  return [`${base}.ts`, `${base}.tsx`, base].find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate)) ?? null;
}

/** Every module one file imports from inside this tree; an in-tree specifier resolving to nothing FAILS rather than being passed over. */
function importsOf(file: string): string[] {
  return [...sourceOf(file).matchAll(/from "([^"]+)"/g)]
    .map(([, specifier]) => specifier ?? "")
    .filter((specifier) => specifier.startsWith("@/") || specifier.startsWith("."))
    .map((specifier) => {
      const target = resolveInTree(file, specifier);
      assert.ok(target !== null, `${path.relative(SRC_DIR, file)} imports ${specifier}, which resolves to no module this sweep can read`);

      return target;
    });
}

function declaresGuard(file: string): boolean {
  return sourceOf(file).includes(KOPF);
}

// Next's own routing convention decides this listing, so a handler added tomorrow is swept with no
// edit here. Both suffixes: `route.tsx` is as much a handler as `route.ts`.
const ROUTES = filesUnder(APP_DIR, (name) => name === "route.ts" || name === "route.tsx", 8);

/* One hop and no further: a handler either reads the header itself or hands the request straight to
   a spine that does, so a guard reached through a chain is reported as no guard at all. */
const guardingByRoute = new Set<string>();
const unguarded: string[] = [];

for (const route of ROUTES) {
  const reached = [route, ...importsOf(route)].filter(declaresGuard);

  if (reached.length === 0) unguarded.push(path.relative(APP_DIR, route));
  for (const file of reached) guardingByRoute.add(file);
}

/* Test files are out: `fl_frontend/src/features/bewerbungen/publicRoutes.test.ts` quotes the
   guard's first line as a fixture, and a sweep taking that for the code would be reading its own
   words back (`.claude/rules/frontend.md`). */
const isSweptSource = (name: string) => /\.tsx?$/.test(name) && !isTestFile(name);

/* The same listing reached off the tree instead of off the routes, which is what leaves either one
   able to fail (`docs/_standard/standard.md :: PRE-4`). */
const guardingByTree = filesUnder(SRC_DIR, isSweptSource, 350).filter(declaresGuard);

describe("the cross-site guard every session-less route stands behind", () => {
  /* Two, because a guard answers in one of two shapes — a German sentence a form renders, and a
     bare status for a caller with nothing to render — and a rule read over one proves half of it. */
  it("finds a guarded module for either shape of refusal", () => {
    assert.ok(
      guardingByTree.length >= 2,
      `only ${String(guardingByTree.length)} modules declare the guard, so the rules below reach too little`,
    );
  });

  it("guards every route handler, bar the one that must not be guarded", () => {
    assert.deepEqual(unguarded.sort(), [...UNGUARDED_BY_DECISION].sort());
  });

  /* The guard compared WHOLE, not searched: every weakening leaves the words a search looks for
     standing. A deleted `return` is invisible to `tsc` and to ESLint at --max-warnings 0, a bare
     call being a side effect. */
  it("returns the refusal it builds, on exactly the condition it declares", () => {
    for (const file of guardingByTree) {
      const name = path.relative(SRC_DIR, file);
      const ab = sourceOf(file).slice(sourceOf(file).indexOf(KOPF) + KOPF.length);

      assert.ok(ab.includes(") {"), `${name} reads Sec-Fetch-Site and then branches on nothing`);

      const bedingung = ab.slice(ab.indexOf("if (") + "if (".length, ab.indexOf(") {"));
      // Cut at the statement's own semicolon: the first `}` past the brace can belong to an object
      // literal inside the call rather than to the block.
      const rumpf = ab.slice(ab.indexOf(") {") + ") {".length, ab.indexOf(";", ab.indexOf(") {")) + 1).trim();

      assert.equal(bedingung, BEDINGUNG, `${name}'s condition was widened or made conditional`);
      /* WHICH refusal is deliberately not pinned: `app/api/client-error/route.ts` answers a bare 403
         because no reader renders its body, where both spines answer 200 with a German sentence. */
      assert.match(rumpf, /^return (new )?NextResponse\b/, `${name} builds a refusal it does not return, or answers with something else`);
    }
  });

  it("reaches the same modules by walking the routes and by walking the tree", () => {
    const named = (files: Iterable<string>) => [...files].map((file) => path.relative(SRC_DIR, file)).sort();

    assert.deepEqual(named(guardingByRoute), named(guardingByTree));
  });
});
