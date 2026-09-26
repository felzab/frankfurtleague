import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { filesUnder } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

const { setSession } = doubleActionRequest();

// The real client, so a read it refuses is refused by the code under test; its configuration doubled so
// a call it does send reaches the doubled network below.
const CONFIG = `export const frontend_config = {
  API_URL: "http://backend:8000",
  API_VERSION: 0,
  INTERNAL_API_KEY_BASE: "base-key-double",
  INTERNAL_API_KEY_SYSTEM: "system-key-double",
  INTERNAL_API_KEY_ADMIN: "admin-key-double",
};`;

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { AdminReadWithoutAdministratorError, UnattributedAdminCallError } = await import("@/core/errors.ts");
const { ACTOR_HEADER } = await import("@/core/trace.ts");

const SRC = path.resolve(import.meta.dirname, "..", "..");
const SLICES = path.join(SRC, "features");
const QUERY_FILES = filesUnder(SLICES, (name) => name === "queries.ts", 10).sort();

/** Every exported function of every slice's `queries.ts`, called by name so a read added later is swept too. */
const QUERIES: [string, (...args: unknown[]) => unknown][] = [];
for (const file of QUERY_FILES) {
  const slice = path.basename(path.dirname(file));
  for (const [name, value] of Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>)) {
    if (typeof value === "function") QUERIES.push([`${slice} :: ${name}`, value as (...args: unknown[]) => unknown]);
  }
}

/** Each query called with no arguments against a network that answers nothing: what it threw, and whether it sent an actor. */
async function callEvery(): Promise<{ thrown: Map<string, unknown>; attributed: string[] }> {
  const thrown = new Map<string, unknown>();
  const attributed: string[] = [];

  for (const [name, query] of QUERIES) {
    let sentActor = false;
    const fetched = mock.method(globalThis, "fetch", (_: unknown, init?: RequestInit) => {
      sentActor ||= new Headers(init?.headers).has(ACTOR_HEADER);
      return Promise.reject(new Error("no network in this sweep"));
    });
    try {
      await query();
    } catch (error) {
      thrown.set(name, error);
    } finally {
      fetched.mock.restore();
    }
    if (sentActor) attributed.push(name);
  }

  return { thrown, attributed };
}

/** The modules `file` imports by a static declaration, as paths under `src`; a dynamic `import()` is no edge. */
function staticImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest);
  const found: string[] = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.importClause?.isTypeOnly) continue;

    const specifier = statement.moduleSpecifier.text;
    const base = specifier.startsWith("@/")
      ? path.join(SRC, specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (base === null) continue;

    const resolved = ["", ".ts", ".tsx", "/index.ts"].map((suffix) => base + suffix).find((candidate) => ts.sys.fileExists(candidate));
    if (resolved !== undefined) found.push(path.normalize(resolved));
  }

  return found;
}

describe("every admin-tier read", () => {
  /* Called rather than read: a query opening its scope with anything but `runAdminRead` sends its
     admin-tier call with no actor recorded, which the client refuses by name. */
  it("records the administrator before its call is sent", async () => {
    setSession({ user: { email: "vorstand@example.org" } });
    const { thrown, attributed } = await callEvery();

    const unattributed = [...thrown].filter(([, error]) => error instanceof UnattributedAdminCallError).map(([name]) => name);
    assert.deepEqual(unattributed, [], "these reads sent an admin-tier call with no actor recorded");
    // Non-vacuity: a sweep reaching no admin-tier read at all would pass the line above.
    assert.ok(attributed.length > 0, "no query sent an admin-tier call, so nothing above was swept");
  });

  /* Refused by `runAdminRead` itself rather than by the client after it: the client's refusal would
     leave nothing sent too, and a read made without the administrator's check would pass unseen. */
  it("is refused by its own scope for a session that is no administrator's", async () => {
    setSession({ user: { email: "vorstand@example.org" } });
    const { attributed } = await callEvery();
    setSession(null);
    const { thrown } = await callEvery();

    const refusedElsewhere = attributed.filter((name) => !(thrown.get(name) instanceof AdminReadWithoutAdministratorError));
    assert.deepEqual(refusedElsewhere, [], "these reads were not refused by runAdminRead for a session with no administrator");
  });

  /* Public pages import these modules for their base reads, and the sign-in store is loaded by the
     admin reads alone, at their call. */
  it("leaves the sign-in store out of every query module's static graph", () => {
    const store = path.join(SRC, "core", "auth.ts");
    const reaching: string[] = [];

    for (const file of QUERY_FILES) {
      const seen = new Set<string>();
      const pending = [path.normalize(file)];
      while (pending.length > 0) {
        const next = pending.pop() as string;
        if (seen.has(next)) continue;
        seen.add(next);
        pending.push(...staticImports(next));
      }
      if (seen.has(store)) reaching.push(path.relative(SRC, file));
    }

    assert.deepEqual(reaching, [], "these query modules load the sign-in store for every page that reads them");
  });
});
