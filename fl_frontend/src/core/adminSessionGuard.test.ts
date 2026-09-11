import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACTION_MODULES, actionBodies, ADMIN_ACTION_MODULES, opensMutation } from "@/core/actionSources.ts";

/** The one slice whose actions authorize nobody: `handleSignIn` is reachable without a session, and `signOutAction` ends the one it would check. */
const AUTHORIZES_NOBODY = "features/auth/actions.ts";

/** The guard as an admin action opens, standing ahead of the callback's first statement. */
const OPENS_ON_GUARD = /^ {4}if \(!\(await getAdminSession\(\)\)\) \{\n/;

function opensOnGuard(name: string, body: string): boolean {
  const opener = opensMutation(name);
  const at = body.indexOf(opener);

  return at !== -1 && OPENS_ON_GUARD.test(body.slice(at + opener.length));
}

/* The second of two layers: `fl_frontend/src/proxy.ts` turns an unauthenticated `/admin/:path*` POST
   away (`docs/frontend/spec.md :: I243`), and this one holds whatever reaches an action anyway. No
   other reader sees the pair. */
describe("the session guard every admin server action opens on", () => {
  it("finds every slice's actions module, and places every export each one declares", () => {
    assert.ok(ACTION_MODULES.length >= 10, `expected at least 10 slice action modules, found ${String(ACTION_MODULES.length)}`);

    for (const { file, bodies, exported } of ACTION_MODULES) {
      assert.ok(bodies.size >= 1, `${file} reads as exporting no action at all, so every sweep over it holds of nothing`);
      assert.equal(
        bodies.size,
        exported,
        `${file} exports ${String(exported)} bindings and this reader places ${String(bodies.size)}: an action written as anything but a function declaration is unread here and unguarded`,
      );
    }
  });

  it("places every actions module as an admin one or as the slice that authorizes nobody", () => {
    assert.ok(ADMIN_ACTION_MODULES.length >= 9, `expected at least 9 admin action modules, found ${String(ADMIN_ACTION_MODULES.length)}`);

    for (const { file, wrapped } of ACTION_MODULES) {
      assert.ok(
        wrapped > 0 || file === AUTHORIZES_NOBODY,
        `${file} runs no action through runAdminMutation, so this sweep never reaches it -- an admin slice dropping out this way is exactly what it watches for`,
      );
    }
  });

  it("calls getAdminSession() in every admin action", () => {
    let guarded = 0;

    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
      for (const [name, body] of bodies) {
        assert.ok(
          body.includes("getAdminSession()"),
          `${file} :: ${name} never checks a session, so the proxy's matcher is the only thing between it and any caller`,
        );
        guarded++;
      }
    }

    assert.ok(guarded >= 35, `expected at least 35 admin actions guarded, found ${String(guarded)}`);
  });

  it("calls it ahead of everything else the action does", () => {
    for (const { file, bodies } of ADMIN_ACTION_MODULES) {
      for (const [name, body] of bodies) {
        assert.ok(
          opensOnGuard(name, body),
          `${file} :: ${name} opens some other callback, or does work before it checks the session (\`docs/frontend/spec.md :: I7\`)`,
        );
      }
    }
  });

  it("reads a guard that stands first apart from one that comes late, and from none at all", () => {
    /* The reader on input rather than on the tree: every action in the tree opens the same way, so
       no count over them separates this reader from one that answers true for anything handed it. */
    const sample = [
      "export async function firstAction(payload: P): Promise<R> {",
      '  return runAdminMutation("firstAction", async () => {',
      "    if (!(await getAdminSession())) {",
      "      return { success: false, error: ADMIN_FORBIDDEN };",
      "    }",
      "    return { success: true };",
      "  });",
      "}",
      "",
      "export async function lateAction(payload: P): Promise<R> {",
      '  return runAdminMutation("lateAction", async () => {',
      "    const validated = Schema.safeParse(payload);",
      "    if (!(await getAdminSession())) {",
      "      return { success: false, error: ADMIN_FORBIDDEN };",
      "    }",
      "    return { success: true, validated };",
      "  });",
      "}",
      "",
      "export async function openAction(payload: P): Promise<R> {",
      '  return runAdminMutation("openAction", async () => {',
      "    /* the guard this replaced called",
      "    if (!(await getAdminSession())) {}",
      "    */",
      "    return { success: true };",
      "  });",
      "}",
    ].join("\n");
    const bodies = actionBodies(sample);

    assert.deepEqual(
      [...bodies.keys()],
      ["firstAction", "lateAction", "openAction"],
      "an export was lost, or something that is not one was read as an action",
    );
    assert.ok(opensOnGuard("firstAction", bodies.get("firstAction") ?? ""), "the reader misses a guard standing at the callback's top level");
    assert.ok(
      !opensOnGuard("lateAction", bodies.get("lateAction") ?? ""),
      "a guard standing behind a statement answered for an action that opens on one",
    );
    assert.ok(
      !(bodies.get("openAction") ?? "").includes("getAdminSession()"),
      "a commented-out call answered for an action that checks no session on any path out",
    );
  });
});
