import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";

/** Every request's headers the sign-out was handed, in order. */
const calls: Headers[] = [];

/** How the next sign-out ends: `signed-out`, `broken`, or `refused` as the library refuses one. */
let outcome: "signed-out" | "broken" | "refused" = "signed-out";

/** Every line the route handed the application's writer, by event and its fields. */
const logged: { event: string; meta: Record<string, unknown> }[] = [];

/* The sign-out replaced at the module boundary: what the library does with the cookie is its own, and this file
   asks what the route makes of each ending. A refusal is shaped as the library raises one. */
const AUTH_DOUBLE = {
  signOutHere: (requestHeaders: Headers) => {
    calls.push(requestHeaders);
    if (outcome === "signed-out") return Promise.resolve({ success: true });
    if (outcome === "broken") return Promise.reject(new Error("the store answered nothing"));
    return Promise.reject(Object.assign(new Error("refused"), { name: "APIError", status: "BAD_REQUEST", body: { code: "FAILED" } }));
  },
};

registerDoubles({
  modules: {
    "core/auth.ts": AUTH_DOUBLE,
    "core/config.ts": { frontend_config: { AUTH_URL: "http://localhost:3000" } },
    "core/logging.ts": {
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (event: string, _error: unknown, meta: Record<string, unknown>) => void logged.push({ event, meta }),
      },
    },
  },
  specifiers: { "next/headers": NEXT_HEADERS_DOUBLE },
});

const handler = await import("./route.ts");
const { NextRequest } = await import("next/server");

const ORIGIN = "http://localhost:3000";

const arrive = (headers: Record<string, string>): InstanceType<typeof NextRequest> =>
  new NextRequest(`${ORIGIN}/api/signout`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "fl.session_token=die-sitzung", ...headers },
    body: "{}",
  });

beforeEach(() => {
  calls.length = 0;
  logged.length = 0;
  outcome = "signed-out";
});

describe("the route a sign-out ends the session at", () => {
  it("ends the session the request's own cookie names, and answers the success at 200", async () => {
    const answer = await handler.POST(arrive({ "sec-fetch-site": "same-origin" }));

    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { success: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.get("cookie"), "fl.session_token=die-sitzung", "the library was handed another request's cookie");
  });

  /* A cross-site post would sign the reader out of this site; a header-less browser is judged by the pinned origin. */
  it("ends nothing for a caller from another site, labelled or not", async () => {
    const crossSite: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { origin: "https://fremde-seite.example" }, {}];
    for (const headers of crossSite) {
      assert.equal((await handler.POST(arrive(headers))).status, 403, JSON.stringify(headers));
    }
    assert.equal(calls.length, 0, "a cross-site post reached the sign-out");

    assert.equal((await handler.POST(arrive({ origin: ORIGIN }))).status, 200);
    assert.equal(calls.length, 1, "a header-less browser on this site was refused");
  });

  it("answers the library's refusal with the retry, at 200", async () => {
    outcome = "refused";

    const answer = await handler.POST(arrive({ "sec-fetch-site": "same-origin" }));

    assert.equal(answer.status, 200);
    assert.deepEqual(await answer.json(), { success: false, error: "Versuche es erneut." });
  });

  /* Thrown past the row's deletion, the session may have ended, so neither a success nor a refusal is true of it. */
  it("answers any other failure as of unknown outcome, at 200, and logs its name alone", async () => {
    outcome = "broken";

    const answer = await handler.POST(arrive({ "sec-fetch-site": "same-origin" }));

    assert.equal(answer.status, 200);
    assert.equal(((await answer.json()) as { outcome?: string }).outcome, "unknown");
    assert.deepEqual(logged, [{ event: "auth.sign_out_failed", meta: { error_code: "FE-ACT-001", name: "Error" } }]);
  });

  /* Nothing a prefetch or a mail gateway fetches signs anybody out. */
  it("answers a GET with no handler at all", () => {
    assert.equal("GET" in handler, false);
    assert.equal(typeof handler.POST, "function");
  });
});
