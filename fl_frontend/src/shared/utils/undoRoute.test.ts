import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import z from "zod";

import { filesUnder } from "@/core/treeWalk.ts";

import type { UndoReport } from "./undoRoute.ts";

/* Replaced at the module boundary, as `fl_frontend/src/app/api/admin/spiele/undo/route.test.ts`
   replaces them: a session and a response are the framework's, and the spine between them is driven. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "next/server": `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`,
  "next/navigation": `export const unstable_rethrow = () => {};`,
  "next/headers": `export const headers = async () => new Headers();`,
};
/**
 * The session each case sets on the bus below; unset, an administrator is signed in. Both exports read
 * that one session, the admin read keeping the role test `fl_frontend/src/core/auth.ts` applies.
 */
const AUTH = `const session = () =>
  globalThis.__flUndoRouteSession === undefined ? { user: { email: "admin@example.de", role: "admin" } } : globalThis.__flUndoRouteSession;
export const auth = async () => session();
export const getAdminSession = async () => (session()?.user?.role === "admin" ? session() : null);`;
const bus = globalThis as unknown as Record<string, unknown>;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { handleUndoRequest } = await import("./undoRoute.ts");
const { ADMIN_FORBIDDEN } = await import("./adminMutation.ts");

const ADMIN_API = path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin");

/** Every undo route, walked rather than listed, so one added is swept with the rest. */
const UNDO_ROUTES = filesUnder(ADMIN_API, (name) => name === "route.ts", 8).filter((file) => path.basename(path.dirname(file)) === "undo");

/**
 * The slices whose replay commits in parts, each named by the sentence it answers when it stops. A
 * replay the backend commits whole words no such sentence and takes no row.
 */
const PART_WAY: Record<string, RegExp> = {
  spieler: /Nur die Personendaten wurden zurückgesetzt/,
  teams: /Nur die Stammdaten wurden zurückgesetzt/,
};

const PAYLOAD = { id: "68c1f0a2b3c4d5e6f7a8b9c0" };

type Undone = { answer: { success: boolean; error?: string }; status: number; invalidated: unknown[]; bodiesRead: number };

/** One undo through the spine, with a restore that answers or throws as `restore` does, and every invalidation it made. */
async function undo(restore: () => Promise<UndoReport>, origin: string | null = "same-origin"): Promise<Undone> {
  const invalidated: unknown[] = [];
  let bodiesRead = 0;
  const request = {
    headers: new Headers(origin === null ? {} : { "sec-fetch-site": origin }),
    json: async () => {
      bodiesRead += 1;
      return PAYLOAD;
    },
  };

  const response = (await handleUndoRequest(request as never, {
    mutationName: "undoRouteTest",
    schema: z.object({ id: z.string() }),
    restore,
    invalidate: (payload) => {
      invalidated.push(payload);
    },
  })) as unknown as { body: Undone["answer"]; status: number };

  return { answer: response.body, status: response.status, invalidated, bodiesRead };
}

describe("what the undo spine clears when a replay stops part-way", () => {
  /* First: the cases below stop a restore part-way, which is worth holding only while a real replay
     can, and an empty walk would hold that of no route at all. */
  it("walks the replays that can leave rows behind", () => {
    assert.ok(UNDO_ROUTES.length >= 8, `the walk found ${String(UNDO_ROUTES.length)} undo routes`);

    for (const [slice, sentence] of Object.entries(PART_WAY)) {
      const route = UNDO_ROUTES.find((file) => file.includes(path.join(slice, "undo")));

      assert.ok(route, `no undo route was walked for ${slice}`);
      assert.match(readFileSync(route, "utf8"), sentence, `${slice}: nothing reports a restore that stopped part-way`);
    }
  });

  /* The defect: an invalidation reached only past the refusal's own return never runs for those
     outcomes, so a cached fixture serves the pre-undo state for a day and a cached club for a week. */
  it("clears the caches before it reports a refusal", async () => {
    const { answer, invalidated } = await undo(async () => ({ refusal: "Nur die Stammdaten wurden zurückgesetzt." }));

    assert.deepEqual(answer, { success: false, error: "Nur die Stammdaten wurden zurückgesetzt." }, "the refusal reaches the admin reworded");
    assert.deepEqual(invalidated, [PAYLOAD], "a restore that stopped part-way leaves the caches serving the rows it had already written");
  });

  it("clears them where the restore throws", async () => {
    const { answer, invalidated } = await undo(async () => {
      throw new Error("the replay's second write failed");
    });

    assert.equal(answer.success, false, "a restore that threw is reported as landed");
    assert.deepEqual(invalidated, [PAYLOAD], "a restore that throws leaves the caches serving the rows it had already written");
  });
});

describe("who the undo spine answers before it does any work", () => {
  /* The spine's own authorization: the backend refuses too, but that is a different service, and
     `proxy.ts` matches `/admin/:path*`, never `/api/admin/*`. */
  it("refuses a caller with no admin session before reading the body or restoring anything", async () => {
    bus.__flUndoRouteSession = null;
    let restored = 0;

    try {
      const { answer, status, invalidated, bodiesRead } = await undo(async () => {
        restored += 1;
        return {};
      });

      assert.deepEqual(answer, { success: false, error: ADMIN_FORBIDDEN }, "the session check falls through instead of refusing");
      assert.equal(status, 401, "the refusal is answered with a status the dispatch reads as something else");
      // First rather than merely before the restore: a check behind the body's read has already worked for a caller nobody authorized.
      assert.equal(bodiesRead, 0, "the body is read for a caller nobody has authorized");
      assert.equal(restored, 0, "the undo restores without checking who is asking");
      assert.deepEqual(invalidated, [], "the caches are cleared for a caller nobody has authorized");
    } finally {
      delete bus.__flUndoRouteSession;
    }
  });

  /* The line `fl_frontend/src/proxy.ts` draws: a session without the role is sent to `/` rather than to
     sign in again, where the allowlist that removed its address would refuse it once more. */
  it("answers a session without the admin role apart from a missing one, and still does no work for it", async () => {
    bus.__flUndoRouteSession = { user: { email: "ehemalig@example.de", role: "user" } };
    let restored = 0;

    try {
      const { answer, status, invalidated, bodiesRead } = await undo(async () => {
        restored += 1;
        return {};
      });

      assert.equal(status, 403, "a signed-in session without the role is answered as though nobody were signed in");
      // The envelope, which is what tells this 403 from an edge's challenge in the dispatch.
      assert.equal(answer.success, false, "the refusal carries no outcome the dispatch can recognise as the route's");
      assert.equal(bodiesRead, 0, "the body is read for a caller nobody has authorized");
      assert.equal(restored, 0, "the undo restores for a session without the role");
      assert.deepEqual(invalidated, [], "the caches are cleared for a caller nobody has authorized");
    } finally {
      delete bus.__flUndoRouteSession;
    }
  });
});

/** Every value a browser sends in `Sec-Fetch-Site`, and the browser too old to send any. */
const ORIGINS: readonly (string | null)[] = ["same-origin", "same-site", "cross-site", "none", null];

describe("what stands in for a session on the undo spine", () => {
  /* Every value a browser sends, so a widened condition or a refusal built and not returned fails;
     `null` passes deliberately, a browser too old to send it is still an administrator's browser. */
  it("refuses every other origin, and lets the page's own requests and a header-less one through", async () => {
    for (const origin of ORIGINS) {
      let restored = 0;
      const { answer, bodiesRead } = await undo(async () => {
        restored += 1;
        return {};
      }, origin);
      const isCrossOrigin = origin !== null && origin !== "same-origin";

      assert.equal(
        restored > 0 || bodiesRead > 0,
        !isCrossOrigin,
        `a request marked ${String(origin)} is ${isCrossOrigin ? "worked on" : "turned away"}`,
      );
      if (isCrossOrigin)
        assert.match(answer.error ?? "", /kam nicht von dieser Seite/, `a request marked ${origin} is answered with something else`);
    }
  });

  /* 200 with the outcome in the body: the dispatch throws on any other status and reports the throw as
     a connection fault, which sends an administrator to check a network that is fine. */
  it("answers the refusal in German the dispatch actually renders", async () => {
    const { answer, status } = await undo(async () => ({}), "cross-site");

    assert.equal(status, 200, "the spine answers a status no caller reads past");
    assert.equal(answer.success, false, "a cross-site request is reported as answered");
    // The admin's own half: the undo did not happen and the change stands.
    assert.match(answer.error ?? "", /^Die Änderung steht weiterhin\./, "the refusal stopped saying the change still stands");
  });
});
