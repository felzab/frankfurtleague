import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";

/** What the real sign-in answers: the session's own cookie value among its fields. */
const MINTED = "fabricated-session-token";

/** Every body the sign-in was handed, in order. */
const calls: { email: string; otp: string }[] = [];

/** Every body the route asked to take back as no failure, by reference. */
const forgiven: object[] = [];

/** How the next sign-in ends: `signed-in`, `broken`, or the code of the refusal it raises. */
let outcome = "signed-in";

/** The session the caller's own cookie names as the library reads it, which `holding` sets. */
let served: unknown = null;

/** That session as the guards read it: `null` where they refuse it, which `holding` sets alike. */
let admitted: unknown = null;

/** Set by a case for the sign-in store failing the guards' read. */
let storeDown = false;

/** Every line the route handed the application's writer, by event and code. */
const logged: { event: string; meta: Record<string, unknown> }[] = [];
const LOGGING_DOUBLE = {
  logger: {
    info: () => undefined,
    warn: () => undefined,
    error: (event: string, _error: unknown, meta: Record<string, unknown>) => void logged.push({ event, meta }),
  },
};

/* The sign-in replaced at the module boundary: which answer it reaches for which address is
   `fl_frontend/src/core/auth.test.ts`'s subject, and this file asks what the route makes of each. A
   refusal is shaped as the library raises one. */
const AUTH_DOUBLE = {
  ADDRESS_ATTEMPTS_EXHAUSTED: "ADDRESS_ATTEMPTS_EXHAUSTED",
  forgiveCodeAttempt: (body: object) => {
    forgiven.push(body);
    return Promise.resolve();
  },
  readAdmittedSession: () => (storeDown ? Promise.reject(new Error("the store answered nothing")) : Promise.resolve(admitted)),
  auth: {
    api: {
      signInEmailOTP: ({ body }: { body: { email: string; otp: string } }) => {
        calls.push(body);
        if (outcome === "signed-in") return Promise.resolve({ token: MINTED, user: {} });
        if (outcome === "broken") return Promise.reject(new Error("the store answered nothing"));
        const refusal = Object.assign(new Error(outcome), {
          name: "APIError",
          // A status-only refusal, as `APIError.fromStatus` raises one, carries no code.
          body: outcome === "SERVICE_UNAVAILABLE" ? undefined : { code: outcome, message: outcome },
          status: outcome === "SERVICE_UNAVAILABLE" ? "SERVICE_UNAVAILABLE" : "BAD_REQUEST",
        });
        return Promise.reject(refusal);
      },
      getSession: () => Promise.resolve(served),
    },
  },
};

/* The one module of the route's that would import the real mail shell for a figure. */
const AUTH_EMAIL_DOUBLE = { CODE_VALIDITY_MINUTES: 10 };

const CONFIG_DOUBLE = { frontend_config: { AUTH_URL: "http://localhost:3000" } };

registerDoubles({
  modules: {
    "core/auth.ts": AUTH_DOUBLE,
    "core/authEmail.ts": AUTH_EMAIL_DOUBLE,
    "core/config.ts": CONFIG_DOUBLE,
    "core/logging.ts": LOGGING_DOUBLE,
  },
  specifiers: {
    // Its real `headers()` throws outside a request scope.
    "next/headers": NEXT_HEADERS_DOUBLE,
  },
});

const handler = await import("./route.ts");
const { NextRequest } = await import("next/server");

const ORIGIN = "http://localhost:3000";
const ADDRESS = "vorstand@example.org";
const CODE = "048213";

function arrive(body: string, headers: Record<string, string>): InstanceType<typeof NextRequest> {
  return new NextRequest(`${ORIGIN}/api/signin/code`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
}

/** The post every browser this application supports makes, which labels its own request. */
const post = (payload: unknown, headers: Record<string, string> = {}) =>
  arrive(JSON.stringify(payload), { "sec-fetch-site": "same-origin", ...headers });

/** A browser too old to send `Sec-Fetch-Site`. */
const postUnlabelled = (payload: unknown, headers: Record<string, string> = {}) => arrive(JSON.stringify(payload), headers);

/** The session the caller's own cookie names, which the guards serve unless `refused`. */
function holding(email: string, madeMsAgo: number, { refused = false }: { refused?: boolean } = {}): void {
  served = { user: { email }, session: { createdAt: new Date(Date.now() - madeMsAgo) } };
  admitted = refused ? null : served;
}

beforeEach(() => {
  calls.length = 0;
  outcome = "signed-in";
  served = null;
  admitted = null;
  storeDown = false;
  logged.length = 0;
});

describe("the route a typed code is checked at", () => {
  it("signs the reader in, and answers the success alone", async () => {
    const answer = await handler.POST(post({ email: ADDRESS, code: CODE }));

    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { success: true });
    assert.deepEqual(calls, [{ email: ADDRESS, otp: CODE }]);
  });

  /* The send folds the address before the library writes the code row, so a check handed another
     spelling looks for a row that is not there, and a ban ending sessions by the stored address misses the account. */
  it("hands the library the folded address, whatever spelling the page posted", async () => {
    await handler.POST(post({ email: "Vorstand@Example.ORG", code: CODE }));

    assert.deepEqual(calls, [{ email: ADDRESS, otp: CODE }]);
  });

  it("words each of the library's refusals, on a 200 this application decided", async () => {
    const expected: readonly (readonly [string, string])[] = [
      ["INVALID_OTP", "Der Code stimmt nicht oder gilt nicht mehr. Nimm den Code aus der neuesten E-Mail oder fordere einen neuen an."],
      ["OTP_EXPIRED", "Der Code ist abgelaufen. Fordere einen neuen an."],
      ["TOO_MANY_ATTEMPTS", "Zu viele Versuche mit diesem Code. Fordere einen neuen an."],
      [
        "ADDRESS_ATTEMPTS_EXHAUSTED",
        "Zu viele Versuche mit dieser Adresse. Melde Dich mit einem Passkey an oder versuche es in 24 Stunden wieder.",
      ],
      ["SIGN_IN_BARRED", "Diese E-Mail-Adresse ist gesperrt. Solange die Sperre gilt, ist keine Anmeldung möglich."],
      [
        "SIGN_IN_HOLDS_NOTHING",
        "Mit dieser Adresse ist derzeit keine Anmeldung möglich. Wenn Du das für einen Fehler hältst, schreib uns an kontakt@frankfurtleague.de.",
      ],
      // The mint's backend unreachable, and any refusal a release adds: the retry, never a 500.
      // Spent before the mint was asked, so retyping it would only meet a wrong code.
      [
        "SERVICE_UNAVAILABLE",
        "Die Anmeldung hat gerade nicht geklappt, und Dein Code ist damit verbraucht. Fordere in ein paar Minuten einen neuen an.",
      ],
      ["SOME_NEW_REFUSAL", "Versuche es erneut."],
    ];

    for (const [code, sentence] of expected) {
      outcome = code;
      const answer = await handler.POST(post({ email: ADDRESS, code: CODE }));

      assert.equal(answer.status, 200, `${code} was answered at another status`);
      assert.deepEqual(await answer.json(), { success: false, error: sentence }, `${code} was worded otherwise`);
    }
  });

  /* A second tab of one sign-in meets a code the first already spent: the reader is signed in, so
     the tab is sent on rather than told the code was wrong. */
  it("sends on a wrong code from a caller the code already signed in, minutes ago, at this address", async () => {
    outcome = "INVALID_OTP";
    holding(ADDRESS, 60 * 1000);

    const before = calls.length;
    const answer: unknown = await (await handler.POST(post({ email: ADDRESS, code: CODE }))).json();

    // Never a bare success: a caller confirming a change must not read another tab's sign-in as one.
    assert.deepEqual(answer, { success: true, bereits: true });
    assert.equal(forgiven.at(-1), calls[before], "the refused attempt stayed counted against the address");
  });

  /* The window is the code's own: a confirmation asked of an older session is never answered by the
     session it confirms, and another address's session is no evidence at all. */
  it("refuses that wrong code where the session is older than a code's window, or another address's", async () => {
    outcome = "INVALID_OTP";

    for (const [email, age] of [
      [ADDRESS, 11 * 60 * 1000],
      ["jemand@example.org", 60 * 1000],
    ] as const) {
      holding(email, age);
      assert.equal(((await (await handler.POST(post({ email: ADDRESS, code: CODE }))).json()) as { success: boolean }).success, false);
    }
  });

  /* A session the library still reads but every guard refuses -- its passkey gone, its address barred --
     is no sign-in: its wrong code stays counted (`docs/frontend/spec.md :: I313`). */
  it("refuses that wrong code where the guards serve the caller's session to nobody", async () => {
    outcome = "INVALID_OTP";
    holding(ADDRESS, 60 * 1000, { refused: true });
    const forgivenBefore = forgiven.length;

    const answer: unknown = await (await handler.POST(post({ email: ADDRESS, code: CODE }))).json();

    assert.deepEqual(answer, {
      success: false,
      error: "Der Code stimmt nicht oder gilt nicht mehr. Nimm den Code aus der neuesten E-Mail oder fordere einen neuen an.",
    });
    assert.equal(forgiven.length, forgivenBefore, "a guess from a session no guard serves was taken back");
  });

  it("answers that wrong code with the retry, at 200, where the store cannot say whether the caller is signed in", async () => {
    outcome = "INVALID_OTP";
    holding(ADDRESS, 60 * 1000);
    storeDown = true;
    const forgivenBefore = forgiven.length;

    const answer = await handler.POST(post({ email: ADDRESS, code: CODE }));

    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { success: false, error: "Versuche es erneut." });
    assert.equal(forgiven.length, forgivenBefore, "a guess was taken back on a read that never answered");
    assert.deepEqual(
      logged.map(({ event, meta }) => [event, meta.error_code]),
      [["auth.signed_in_unread", "FE-AUTH-002"]],
    );
  });

  /* Only a wrong code: an expired or exhausted one is refused whatever the caller holds. */
  it("refuses an expired code even from a caller signed in minutes ago", async () => {
    outcome = "OTP_EXPIRED";
    holding(ADDRESS, 60 * 1000);

    assert.equal(((await (await handler.POST(post({ email: ADDRESS, code: CODE }))).json()) as { success: boolean }).success, false);
  });

  /* Never a wrong code, and never a throw: its 500 is worded by the page as an answer from in front
     of this application. */
  it("answers a failure the library did not raise with the retry, at 200, and logs its name alone", async () => {
    outcome = "broken";

    const answer = await handler.POST(post({ email: ADDRESS, code: CODE }));

    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { success: false, error: "Versuche es erneut." });
    assert.deepEqual(logged, [{ event: "auth.code_check_failed", meta: { error_code: "FE-AUTH-002", name: "Error" } }]);
  });

  it("answers a body it cannot read as a wrong code, and reaches the library not at all", async () => {
    for (const request of [
      arrive("kein json", { "sec-fetch-site": "same-origin" }),
      post({ email: ADDRESS, code: "04821" }),
      post({ email: ADDRESS, code: "04821x" }),
      post({ code: CODE }),
      post({ email: "keine-adresse", code: CODE }),
    ]) {
      assert.deepEqual(await (await handler.POST(request)).json(), {
        success: false,
        error: "Der Code stimmt nicht oder gilt nicht mehr. Nimm den Code aus der neuesten E-Mail oder fordere einen neuen an.",
      });
    }
    assert.deepEqual(calls, []);
  });

  it("reaches the library not at all for a cross-site caller", async () => {
    const answer = await handler.POST(post({ email: ADDRESS, code: CODE }, { "sec-fetch-site": "cross-site" }));

    assert.equal(answer.status, 403);
    assert.deepEqual(calls, []);
  });

  /* This spends a credential, so an absent header falls back to the pinned origin, never the caller's. */
  it("checks a header-less browser's code only where the request names this origin", async () => {
    assert.equal((await handler.POST(postUnlabelled({ email: ADDRESS, code: CODE }, { origin: ORIGIN }))).status, 200);
    assert.equal(calls.length, 1);

    const fremd = await handler.POST(postUnlabelled({ email: ADDRESS, code: CODE }, { origin: "https://fremde-seite.example" }));
    const stumm = await handler.POST(postUnlabelled({ email: ADDRESS, code: CODE }));

    assert.equal(fremd.status, 403);
    assert.equal(stumm.status, 403);
    assert.equal(calls.length, 1, "a cross-site post spent the reader's code");
  });

  /* Nothing a mail gateway or a prefetch fetches may spend a code. */
  it("answers a GET with no handler at all", () => {
    assert.equal("GET" in handler, false);
    assert.equal(typeof handler.POST, "function");
  });

  /* The one copy of that value a browser may hold is the `httpOnly` cookie: in a body or a header of
     its own it is a bearer credential any script on the page can read. */
  it("hands the minted session's value to neither the body nor a header", async () => {
    const answer = await handler.POST(post({ email: ADDRESS, code: CODE }));

    assert.ok(!(await answer.clone().text()).includes(MINTED), "the minted session's value reached the body");
    for (const [name, value] of answer.headers) {
      assert.ok(!value.includes(MINTED), `the minted session's value reached the ${name} header`);
    }
  });
});
