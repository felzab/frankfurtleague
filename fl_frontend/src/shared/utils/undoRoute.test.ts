import assert from "node:assert/strict";
import { describe, it } from "node:test";

import z from "zod";

import { registerDoubles } from "@/core/exportingModule.ts";
import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";

import type { UndoReport } from "./undoRoute.ts";

/* Replaced at the module boundary, as `fl_frontend/src/app/api/admin/spiele/undo/route.test.ts`
   replaces them: a session and a response are the framework's, and the spine between them is driven. */
const PACKAGE_DOUBLES = {
  "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => ({ body, status: init?.status ?? 200 }) } },
  "next/navigation": { unstable_rethrow: () => undefined },
  "next/headers": NEXT_HEADERS_DOUBLE,
  // Throws as Next does outside a server action, so a route that reached it fails here.
  "next/cache": {
    refresh: (): never => {
      throw new Error("refresh() outside a server action");
    },
  },
};
type ServedSession = { user: { email: string }; session: { authFactor: string } } | null;

/**
 * The session each case sets; unset, an administrator is signed in. The landing derives from that one
 * session, so a case cannot set a verdict its session contradicts.
 */
let undoRouteSession: ServedSession | undefined;

const GRANTED = "admin@example.de";
const session = (): ServedSession =>
  undoRouteSession === undefined ? { user: { email: GRANTED }, session: { authFactor: "passkey" } } : undoRouteSession;
const through = (): boolean => {
  const served = session();
  return served !== null && served.user.email === GRANTED && served.session.authFactor === "passkey";
};
/** Whether the backend leaves the grant unanswered for the rest of a case. */
let grantUnread = false;

/* Replaced whole, its export names read off the real module: a name the spine starts importing then
   links, where a hand-kept list failed this suite before its first case. */
const AUTH = {
  getAdminSession: async () => (through() && !grantUnread ? session() : null),
  isFreshlySignedIn: () => true,
  judgeAdminRequest: async () => {
    const served = session();
    if (served === null) return { refused: "signIn" };
    if (grantUnread) return { refused: "unread" };
    // A passkey session holding no grant is one whose grant is gone; a code-made one a person's.
    if (served.user.email !== GRANTED) return { refused: served.session.authFactor === "passkey" ? "grantGone" : "noGrant" };
    return through() ? { session: served } : { refused: "signIn" };
  },
  // Answering where the spine asked the landing after its guard's own verdict: a second read of the session.
  getSignInDestination: async () => {
    throw new Error("the undo spine read the landing for a status its guard already judged");
  },
};
const inert = (): undefined => undefined;
const LOGGING = { logger: { debug: inert, info: inert, warn: inert, error: inert } };

registerDoubles({ modules: { "core/auth.ts": AUTH, "core/logging.ts": LOGGING }, specifiers: PACKAGE_DOUBLES });

const { handleUndoRequest, replayRefusal } = await import("./undoRoute.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
const { recordWriteSent } = await import("@/core/requestScope.ts");
const { ADMIN_FORBIDDEN, FORBIDDEN_BY_REFUSAL } = await import("./adminMutation.ts");
const { AENDERUNG_STEHT_WEITERHIN, ZUGANG_WEG } = await import("./actionError.ts");

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
    tags: (payload) => {
      invalidated.push(payload);
      return [];
    },
  })) as unknown as { body: Undone["answer"]; status: number };

  return { answer: response.body, status: response.status, invalidated, bodiesRead };
}

describe("what the undo spine clears when a replay stops part-way", () => {
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
      recordWriteSent();
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
     `proxy.ts` matches pages under `/bereich` and `/signin`, never `/api/admin/*`. */
  it("refuses a caller with no admin session before reading the body or restoring anything", async () => {
    undoRouteSession = null;
    let restored = 0;

    try {
      const { answer, status, invalidated, bodiesRead } = await undo(async () => {
        restored += 1;
        return {};
      });

      assert.deepEqual(
        answer,
        { success: false, error: `${ADMIN_FORBIDDEN} Die Änderung steht weiterhin.` },
        "the session check falls through instead of refusing",
      );
      assert.equal(status, 401, "the refusal is answered with a status the dispatch reads as something else");
      // First rather than merely before the restore: a check behind the body's read has already worked for a caller nobody authorized.
      assert.equal(bodiesRead, 0, "the body is read for a caller nobody has authorized");
      assert.equal(restored, 0, "the undo restores without checking who is asking");
      assert.deepEqual(invalidated, [], "the caches are cleared for a caller nobody has authorized");
    } finally {
      undoRouteSession = undefined;
    }
  });

  /* The line `fl_frontend/src/proxy.ts` draws: a session holding no grant goes to the person's own
     `/bereich`, a sign-in granting it nothing, told the cause an action would be told and that the
     change stands. */
  it("answers a session holding no grant apart from a missing one, and still does no work for it", async () => {
    // A person's code-made session, and an administrator's passkey session whose grant is gone.
    const told: Record<string, string> = {
      code: `${ZUGANG_WEG} Die Änderung steht weiterhin.`,
      passkey: `${ZUGANG_WEG} Die Änderung steht weiterhin.`,
    };
    for (const authFactor of ["code", "passkey"]) {
      undoRouteSession = { user: { email: "ehemalig@example.de" }, session: { authFactor } };
      let restored = 0;

      try {
        const { answer, status, invalidated, bodiesRead } = await undo(async () => {
          restored += 1;
          return {};
        });

        assert.equal(status, 403, `a ${authFactor} session holding no grant is answered as though nobody were signed in`);
        // The envelope, which is what tells this 403 from an edge's challenge in the dispatch.
        assert.equal(answer.success, false, "the refusal carries no outcome the dispatch can recognise as the route's");
        assert.equal(answer.error, told[authFactor], `a ${authFactor} session holding no grant is told another cause`);
        assert.equal(bodiesRead, 0, "the body is read for a caller nobody has authorized");
        assert.equal(restored, 0, "the undo restores for a session nobody authorized");
        assert.deepEqual(invalidated, [], "the caches are cleared for a caller nobody has authorized");
      } finally {
        undoRouteSession = undefined;
      }
    }
  });

  /* The other half of the split: an administrator who has followed the link and not yet presented
     the passkey is 401, which sends them somewhere they can finish, rather than 403 to a person's landing. */
  it("answers a granted session short of the second factor the way it answers a missing one", async () => {
    undoRouteSession = { user: { email: "admin@example.de" }, session: { authFactor: "link" } };
    let restored = 0;

    try {
      const { status, invalidated } = await undo(async () => {
        restored += 1;
        return {};
      });

      assert.equal(status, 401, "an administrator short of the factor is sent to a person's landing with no way to the step");
      assert.equal(restored, 0, "the undo restores for a session short of the second factor");
      assert.deepEqual(invalidated, [], "the caches are cleared for a caller nobody has authorized");
    } finally {
      undoRouteSession = undefined;
    }
  });

  /* A 401 would send an administrator to sign in again into the same unread grant, and a 403 to a
     person's landing: the undo did not run, which the route's own refusal says where the admin stands. */
  it("answers a grant the backend left unread as a refusal, turning nobody away and doing no work", async () => {
    grantUnread = true;
    let restored = 0;

    try {
      const { answer, status, bodiesRead } = await undo(async () => {
        restored += 1;
        return {};
      });

      assert.equal(status, 200, "an unread grant turned the administrator away");
      assert.equal(answer.success, false);
      assert.ok(answer.error?.endsWith(AENDERUNG_STEHT_WEITERHIN), "the refusal does not say the change stands");
      assert.ok(!answer.error?.startsWith(ADMIN_FORBIDDEN), "an unread grant is told it holds no administration");
      assert.equal(bodiesRead, 0, "the body is read for a caller nobody has authorized");
      assert.equal(restored, 0, "the undo restores while the grant is unread");
    } finally {
      grantUnread = false;
    }
  });

  /* Each reason in the action's own words, so the save and its undo never word one condition two ways:
     an arm answering another reason's sentence reads as a cause the administrator does not have. */
  it("answers every reason its guard turns a caller away for in the action's sentence, and that the change stands", async () => {
    // Typed by the table's own key, so a reason added there fails to compile here until it is driven.
    const arrange: Record<keyof typeof FORBIDDEN_BY_REFUSAL, () => void> = {
      signIn: () => (undoRouteSession = null),
      noGrant: () => (undoRouteSession = { user: { email: "ehemalig@example.de" }, session: { authFactor: "code" } }),
      grantGone: () => (undoRouteSession = { user: { email: "ehemalig@example.de" }, session: { authFactor: "passkey" } }),
      unread: () => (grantUnread = true),
    };

    for (const [reason, sentence] of Object.entries(FORBIDDEN_BY_REFUSAL)) {
      arrange[reason as keyof typeof FORBIDDEN_BY_REFUSAL]();
      try {
        const { answer } = await undo(async () => ({}));

        assert.deepEqual(answer, { success: false, error: `${sentence} ${AENDERUNG_STEHT_WEITERHIN}` }, `the ${reason} arm`);
      } finally {
        undoRouteSession = undefined;
        grantUnread = false;
      }
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

  /* Codes are unique across the API, so a rule moved to another status keeps its row. */
  it("answers the table's sentence for a refusal carrying one of its codes, at whatever status", () => {
    for (const status of [409, 422, 404, 410, 403]) {
      assert.equal(replayRefusal(refused(status, "REQ-TEST-001"), TABLE), TABLE["REQ-TEST-001"], String(status));
    }
  });

  // `undefined` is the route's cue to rethrow, so each of these reaches the spine as a failure.
  it("answers nothing for an unmapped code, a server error, or anything but a refusal", () => {
    assert.equal(replayRefusal(refused(409, "REQ-TEST-002"), TABLE), undefined, "an unmapped code was worded");
    // The replay may have landed behind a 5xx, which a refusal's "Die Änderung steht weiterhin." would deny.
    assert.equal(replayRefusal(refused(500, "REQ-TEST-001"), TABLE), undefined, "a server error was worded as a refusal");
    assert.equal(replayRefusal(new Error("network"), TABLE), undefined, "a thrown error that is no refusal was worded");
  });

  it("reads the table with `hasOwn`, so a code named for a prototype key is not a refusal", () => {
    assert.equal(replayRefusal(refused(409, "toString"), TABLE), undefined);
  });
});
