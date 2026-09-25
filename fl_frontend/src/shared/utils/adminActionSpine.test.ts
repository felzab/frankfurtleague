import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { filesUnder } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

doubleActionRequest({ session: null });

// The sign-in actions take `after` from it: Node resolves the package's subpath only with its extension,
// where Next's own bundler needs none.
registerHooks({
  resolve: (specifier, context, nextResolve) => nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context),
});

const { ADMIN_FORBIDDEN } = await import("./adminMutation.ts");

/**
 * The two actions that authorize nobody, named by export rather than by their slice, so an admin action added
 * beside them is called too: `handleSignIn` is reachable without a session, and `signOutAction` ends the one it
 * would check.
 */
const AUTHORIZES_NOBODY: ReadonlySet<string> = new Set(["auth :: handleSignIn", "auth :: signOutAction"]);

const SLICES = path.resolve(import.meta.dirname, "..", "..", "features");

describe("every admin server action", () => {
  /* Each export called, never its source read: an action outside `runAdminMutation`, or one the spine
     does not guard, validates the missing payload or reaches the backend, and answers something else. */
  it("answers a caller with no admin session through the spine's guard, before any work", async () => {
    const fetched = mock.method(globalThis, "fetch", () => Promise.reject(new Error("an admin action reached the network for nobody")));
    const exempted = new Set<string>();

    try {
      for (const file of filesUnder(SLICES, (name) => name === "actions.ts", 10).sort()) {
        const slice = path.basename(path.dirname(file));
        const actions = Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>);
        assert.ok(actions.length > 0, `${slice}'s actions module exports nothing, so nothing here holds it`);

        for (const [name, action] of actions) {
          assert.equal(typeof action, "function", `${slice} :: ${name} is exported from a "use server" module and is no action`);
          if (AUTHORIZES_NOBODY.has(`${slice} :: ${name}`)) {
            exempted.add(`${slice} :: ${name}`);
            continue;
          }

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
    // Each exemption met its export, so one outliving its action cannot stand ready for a later one of that name.
    assert.deepEqual([...exempted].sort(), [...AUTHORIZES_NOBODY].sort());
  });
});
