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
 * The session each case sets on the bus below; unset, an administrator is signed in. The landing
 * derives from that one session, so a case cannot set a verdict its session contradicts.
 */
const AUTH = `const ALLOWLISTED = "admin@example.de";
const session = () =>
  globalThis.__flUndoRouteSession === undefined
    ? { user: { email: ALLOWLISTED }, session: { authFactor: "passkey" } }
    : globalThis.__flUndoRouteSession;
const through = () => {
  const served = session();
  return served !== null && served.user.email === ALLOWLISTED && served.session.authFactor === "passkey";
};
export const getAdminSession = async () => (through() ? session() : null);
export const getSignInDestination = async () => {
  const served = session();
  if (served === null) return "/signin";
  if (served.user.email !== ALLOWLISTED) return "/";
  return through() ? "/admin" : "/signin";
};`;
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

const { handleUndoRequest, replayRefusal } = await import("./undoRoute.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
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

/** The ruling's words for an undo nobody can tell landed. */
const RUECKNAHME_UNKLAR = "Ob die Änderung zurückgenommen wurde, ist unklar. Lade die Seite neu und prüfe sie.";

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

describe("what the undo spine answers when nobody can tell whether its replay landed", () => {
  /* A replay is a write, and one throwing after it wrote leaves the row restored: answered as a
     failure, the admin undoes it a second time. The shared reader's sentence speaks of a save. */
  it("answers a throw of the replay's own code as of unknown outcome, in words about the undo", async () => {
    const { answer, status } = await undo(async () => {
      throw new RangeError("Invalid time value");
    });

    assert.equal(status, 200);
    assert.deepEqual(answer, { success: false, error: RUECKNAHME_UNKLAR, outcome: "unknown" });
  });

  /* An unacknowledged write may still have landed too, and the slice's own sentence says what to check. */
  it("answers an unacknowledged replay as of unknown outcome, in the slice's own sentence", async () => {
    const { answer, invalidated } = await undo(async () => ({ unclear: "Die Rücknahme wurde abgebrochen. Prüfe den Eintrag." }));

    assert.deepEqual(answer, { success: false, error: "Die Rücknahme wurde abgebrochen. Prüfe den Eintrag.", outcome: "unknown" });
    assert.deepEqual(invalidated, [PAYLOAD], "a write that may have landed leaves the caches serving what it replaced");
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

  /* The line `fl_frontend/src/proxy.ts` draws: a session the allowlist does not carry is sent to `/`
     rather than to sign in again, where that same allowlist would refuse it once more. */
  it("answers a session outside the allowlist apart from a missing one, and still does no work for it", async () => {
    bus.__flUndoRouteSession = { user: { email: "ehemalig@example.de" }, session: { authFactor: "passkey" } };
    let restored = 0;

    try {
      const { answer, status, invalidated, bodiesRead } = await undo(async () => {
        restored += 1;
        return {};
      });

      assert.equal(status, 403, "a person's live session is answered as though nobody were signed in");
      // The envelope, which is what tells this 403 from an edge's challenge in the dispatch.
      assert.equal(answer.success, false, "the refusal carries no outcome the dispatch can recognise as the route's");
      assert.equal(bodiesRead, 0, "the body is read for a caller nobody has authorized");
      assert.equal(restored, 0, "the undo restores for a session nobody authorized");
      assert.deepEqual(invalidated, [], "the caches are cleared for a caller nobody has authorized");
    } finally {
      delete bus.__flUndoRouteSession;
    }
  });

  /* The other half of the split: an administrator who has followed the link and not yet presented
     the passkey is 401, which sends them somewhere they can finish, rather than 403 to the root. */
  it("answers an allowlisted session short of the second factor the way it answers a missing one", async () => {
    bus.__flUndoRouteSession = { user: { email: "admin@example.de" }, session: { authFactor: "link" } };
    let restored = 0;

    try {
      const { status, invalidated } = await undo(async () => {
        restored += 1;
        return {};
      });

      assert.equal(status, 401, "an administrator short of the factor is sent to the public root with no way back");
      assert.equal(restored, 0, "the undo restores for a session short of the second factor");
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
    // The reason, the way back, and then what became of the change, as every undo sentence closes.
    assert.equal(
      answer.error,
      "Diese Anfrage kam nicht von dieser Seite. Lade die Seite neu und nimm sie dann erneut zurück. Die Änderung steht weiterhin.",
    );
  });
});

/** A replayed endpoint's refusal, answered as `apiClient` raises it. */
const refused = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend:8000/api/v0/x",
    endpoint: "/x",
    method: "PATCH",
    readOnly: false,
    traceId: "ab".repeat(16),
    statusCode,
    serverErrorCode,
  });

describe("the sentence a replay's refusal is worded with", () => {
  const TABLE = { "REQ-TEST-001": "Die Rücknahme wurde nicht ausgeführt." };

  it("answers the table's sentence for a 409 carrying one of its codes", () => {
    assert.equal(replayRefusal(refused(409, "REQ-TEST-001"), TABLE), TABLE["REQ-TEST-001"]);
  });

  // `undefined` is the route's cue to rethrow, so each of these reaches the spine as a failure.
  it("answers nothing for an unmapped code, another status, or anything but a refusal", () => {
    assert.equal(replayRefusal(refused(409, "REQ-TEST-002"), TABLE), undefined, "an unmapped code was worded");
    assert.equal(replayRefusal(refused(422, "REQ-TEST-001"), TABLE), undefined, "a code under another status was worded");
    assert.equal(replayRefusal(new Error("network"), TABLE), undefined, "a thrown error that is no refusal was worded");
  });

  it("reads the table with `hasOwn`, so a code named for a prototype key is not a refusal", () => {
    assert.equal(replayRefusal(refused(409, "toString"), TABLE), undefined);
  });
});
