import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

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

const { UnattributedAdminCallError } = await import("@/core/errors.ts");
const { ACTOR_HEADER } = await import("@/core/trace.ts");

const SLICES = path.resolve(import.meta.dirname, "..", "..", "features");

/** Every exported function of every slice's `queries.ts`, called by name so a read added later is swept too. */
const QUERIES: [string, (...args: unknown[]) => unknown][] = [];
for (const file of filesUnder(SLICES, (name) => name === "queries.ts", 10).sort()) {
  const slice = path.basename(path.dirname(file));
  for (const [name, value] of Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>)) {
    if (typeof value === "function") QUERIES.push([`${slice} :: ${name}`, value as (...args: unknown[]) => unknown]);
  }
}

/** Each query called with no arguments against a network that answers nothing, reporting what it threw and whether it sent an actor. */
async function callEvery(): Promise<{ unattributed: string[]; attributed: string[] }> {
  const unattributed: string[] = [];
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
      if (error instanceof UnattributedAdminCallError) unattributed.push(name);
    } finally {
      fetched.mock.restore();
    }
    if (sentActor) attributed.push(name);
  }

  return { unattributed, attributed };
}

describe("every admin-tier read", () => {
  /* Called rather than read: a query opening its scope with anything but `runAdminRead` sends its
     admin-tier call with no actor recorded, which the client refuses by name. */
  it("records the administrator before its call is sent", async () => {
    setSession({ user: { email: "vorstand@example.org" } });
    const { unattributed, attributed } = await callEvery();

    assert.deepEqual(unattributed, [], "these reads sent an admin-tier call with no actor recorded");
    // Non-vacuity: a sweep reaching no admin-tier read at all would pass the line above.
    assert.ok(attributed.length > 0, "no query sent an admin-tier call, so nothing above was swept");
  });

  /* Only a caller outside the admin guards reaches this, and it must be loud rather than a read the
     backend would refuse on arrival. */
  it("sends nothing for a session that is no administrator's", async () => {
    setSession(null);
    const { attributed } = await callEvery();

    assert.deepEqual(attributed, [], "these reads reached the network naming an actor for nobody");
  });
});
