import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { exportingModule } from "@/core/exportingModule.ts";
import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";

/** Stands in for `next/headers`, whose real `headers()` throws outside a request scope. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent(NEXT_HEADERS_DOUBLE)}`;

/** What the real sign-in answers: the session's own cookie value among its fields. */
const MINTED = "fabricated-session-token";

/** Every body the sign-in was handed, in order. */
const calls: { email: string; otp: string }[] = [];

/** How the next sign-in ends: `signed-in`, `broken`, or the code of the refusal it raises. */
let outcome = "signed-in";

/** The session the caller's own cookie names, which `holding` sets. */
let served: unknown = null;

/* The sign-in replaced at the module boundary: which answer it reaches for which address is
   `fl_frontend/src/core/auth.test.ts`'s subject, and this file asks what the route makes of each. A
   refusal is shaped as the library raises one. */
const AUTH_DOUBLE = exportingModule({
  ADDRESS_ATTEMPTS_EXHAUSTED: "ADDRESS_ATTEMPTS_EXHAUSTED",
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
        });
        return Promise.reject(refusal);
      },
      getSession: () => Promise.resolve(served),
    },
  },
});

/* The one module of the route's that would import the real mail shell for a figure. */
const AUTH_EMAIL_DOUBLE = "export const CODE_VALIDITY_MINUTES = 10;";

const CONFIG_DOUBLE = `export const frontend_config = { AUTH_URL: "http://localhost:3000" };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/authEmail.ts")) return { format: "module", source: AUTH_EMAIL_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
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

/** The session the caller's own cookie names, as the guard reads it. */
function holding(email: string, madeMsAgo: number): void {
  served = { user: { email }, session: { createdAt: new Date(Date.now() - madeMsAgo) } };
}

beforeEach(() => {
  calls.length = 0;
  outcome = "signed-in";
  served = null;
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
      ["INVALID_OTP", "Der Code stimmt nicht. Prüfe ihn und gib ihn noch einmal ein."],
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
      ["SERVICE_UNAVAILABLE", "Versuche es noch einmal."],
      ["SOME_NEW_REFUSAL", "Versuche es noch einmal."],
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

    assert.deepEqual(await (await handler.POST(post({ email: ADDRESS, code: CODE }))).json(), { success: true });
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

  /* Only a wrong code: an expired or exhausted one is refused whatever the caller holds. */
  it("refuses an expired code even from a caller signed in minutes ago", async () => {
    outcome = "OTP_EXPIRED";
    holding(ADDRESS, 60 * 1000);

    assert.equal(((await (await handler.POST(post({ email: ADDRESS, code: CODE }))).json()) as { success: boolean }).success, false);
  });

  /* A failure that is this application's never reads to the reader as a wrong code. */
  it("throws a failure the library did not raise rather than wording it", async () => {
    outcome = "broken";
    await assert.rejects(() => handler.POST(post({ email: ADDRESS, code: CODE })));
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
        error: "Der Code stimmt nicht. Prüfe ihn und gib ihn noch einmal ein.",
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
