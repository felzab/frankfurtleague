import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { filesUnder } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

doubleActionRequest();

/* The harness's signed-in store with its guard answering no session, every other export of the real
   module still there for an actions module to link against. Registered after the harness, so it runs
   first and edits what the harness answers. */
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (!url.endsWith("/src/core/auth.ts")) return loaded;

    const signedIn = String(loaded.source);
    const signedOut = signedIn.replace(/^export const getAdminSession = .*$/m, "export const getAdminSession = async () => null;");
    if (signedOut === signedIn) throw new Error("the harness's sign-in store declares no getAdminSession line to sign out");

    return { ...loaded, source: signedOut };
  },
});

const { ADMIN_FORBIDDEN } = await import("./adminMutation.ts");

/** The one slice whose actions authorize nobody: `handleSignIn` is reachable without a session, and `signOutAction` ends the one it would check. */
const AUTHORIZES_NOBODY = "auth";

const SLICES = path.resolve(import.meta.dirname, "..", "..", "features");

describe("every admin server action", () => {
  /* Each export called, never its source read: an action outside `runAdminMutation`, or one the spine
     does not guard, validates the missing payload or reaches the backend, and answers something else. */
  it("answers a caller with no admin session through the spine's guard, before any work", async () => {
    const fetched = mock.method(globalThis, "fetch", () => Promise.reject(new Error("an admin action reached the network for nobody")));

    try {
      for (const file of filesUnder(SLICES, (name) => name === "actions.ts", 10).sort()) {
        const slice = path.basename(path.dirname(file));
        if (slice === AUTHORIZES_NOBODY) continue;

        const actions = Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>);
        assert.ok(actions.length > 0, `${slice}'s actions module exports nothing, so nothing here holds it`);

        for (const [name, action] of actions) {
          assert.equal(typeof action, "function", `${slice} :: ${name} is exported from a "use server" module and is no action`);

          assert.deepEqual(
            await (action as () => Promise<unknown>)(),
            { success: false, error: ADMIN_FORBIDDEN },
            `${slice} :: ${name} does work for a caller nobody authorized`,
          );
        }
      }
    } finally {
      fetched.mock.restore();
    }

    assert.equal(fetched.mock.callCount(), 0, "an admin action reached the network for a caller nobody authorized");
  });
});
