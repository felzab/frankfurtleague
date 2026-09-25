import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

/** Stands in for `next/headers`, whose real `headers()` throws outside a request scope. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export const headers = async () => new Headers();")}`;

const SPENT = "__flAnmeldeTokenSpent";

/** What the real verification answers where no `callbackURL` is named: the session's own cookie value. */
const MINTED = "fabricated-session-token";

/* The verification replaced at the module boundary: the real one needs a session store, and it
   consumes its token atomically, so a second call on one token is refused rather than repeated. */
const AUTH_DOUBLE = `export const SIGN_IN_LANDING = "/signin/weiter";
export const auth = {
  api: {
    magicLinkVerify: async ({ query }) => {
      const spent = globalThis.${SPENT};
      spent.push(query.token);
      if (spent.filter((each) => each === query.token).length > 1) {
        const refusal = new Error("INVALID_TOKEN");
        refusal.name = "APIError";
        throw refusal;
      }
      return { token: ${JSON.stringify(MINTED)}, user: {}, session: {} };
    },
  },
};`;

const CONFIG_DOUBLE = `export const frontend_config = { AUTH_URL: "http://localhost:3000" };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** Every token the verification was handed, in order; the double reads it through the global. */
const spent: string[] = [];
Reflect.set(globalThis, SPENT, spent);

const handler = await import("./route.ts");
const { NextRequest } = await import("next/server");

const ORIGIN = "http://localhost:3000";

function arrive(token: string | null, headers: Record<string, string>): InstanceType<typeof NextRequest> {
  const body = new FormData();
  if (token !== null) body.set("token", token);

  return new NextRequest(`${ORIGIN}/api/signin/bestaetigen`, { method: "POST", headers: headers, body: body });
}

/** The press every browser this application supports makes, which labels its own request. */
const press = (token: string | null, headers: Record<string, string> = {}) => arrive(token, { "sec-fetch-site": "same-origin", ...headers });

/** A browser too old to send `Sec-Fetch-Site`, which the shared spine lets through. */
const pressUnlabelled = (token: string, headers: Record<string, string> = {}) => arrive(token, headers);

beforeEach(() => {
  spent.length = 0;
});

describe("the button under the mailed link", () => {
  it("signs the reader in and leaves for the landing that decides where they belong", async () => {
    const answer = await handler.POST(press("ein-lebendiger-token"));

    assert.equal(answer.status, 303);
    assert.equal(answer.headers.get("location"), "/signin/weiter");
    assert.deepEqual(spent, ["ein-lebendiger-token"]);
  });

  /* Single-use is the library's, and the page's refusal is the address with no token on it: a
     second press must never reach the landing, which would read as a sign-in that happened. */
  it("refuses a second press of one link, and leaves for the page's own refusal instead", async () => {
    await handler.POST(press("ein-lebendiger-token"));
    const answer = await handler.POST(press("ein-lebendiger-token"));

    assert.equal(answer.status, 303);
    assert.equal(answer.headers.get("location"), "/signin/bestaetigen");
  });

  it("reaches the verification not at all for a press carrying no token", async () => {
    const answer = await handler.POST(press(null));

    assert.equal(answer.headers.get("location"), "/signin/bestaetigen");
    assert.deepEqual(spent, []);
  });

  it("reaches the verification not at all for a cross-site caller", async () => {
    const answer = await handler.POST(press("ein-lebendiger-token", { "sec-fetch-site": "cross-site" }));

    assert.equal(answer.status, 403);
    assert.deepEqual(spent, []);
  });

  /* The shared spine lets a browser too old to send that header through, which every other handler
     can afford: this one spends a credential, so an absent header falls back to the origin. */
  it("signs a header-less browser in only where the request names this origin", async () => {
    const named = await handler.POST(pressUnlabelled("ein-lebendiger-token", { origin: ORIGIN }));

    assert.equal(named.status, 303);
    assert.deepEqual(spent, ["ein-lebendiger-token"]);
  });

  it("refuses a header-less request naming another origin, and one naming none", async () => {
    const fremd = await handler.POST(pressUnlabelled("ein-lebendiger-token", { origin: "https://fremde-seite.example" }));
    const stumm = await handler.POST(pressUnlabelled("ein-lebendiger-token"));

    assert.equal(fremd.status, 403);
    assert.equal(stumm.status, 403);
    assert.deepEqual(spent, [], "a cross-site press spent the reader's link");
  });

  /* The whole reason the link opens a page: a mail gateway fetches every link in a message, so a handler answering
     a GET would spend the token before the reader opened the mail. */
  it("answers a GET with no handler at all, so a gateway's fetch of the link spends nothing", () => {
    assert.equal("GET" in handler, false);
    assert.equal(typeof handler.POST, "function");
  });

  /* The one copy of that value a browser may hold is the `httpOnly` cookie: forwarded into a body or
     a header of its own it is a bearer credential any script on the page can read. */
  it("hands the reader an empty body on all three exits, and the minted session's value in no header", async () => {
    const signedIn = await handler.POST(press("ein-lebendiger-token"));
    const withoutToken = await handler.POST(press(null));
    const spentAgain = await handler.POST(press("ein-lebendiger-token"));

    for (const answer of [signedIn, withoutToken, spentAgain]) {
      assert.equal(answer.status, 303);
      assert.equal(await answer.text(), "", `the exit to ${String(answer.headers.get("location"))} answered with a body`);
    }

    // `Set-Cookie` excepted, which is where the real flow's own copy belongs and which this double
    // never writes: everything else on the response is readable from the page.
    for (const [name, value] of signedIn.headers) {
      if (name === "set-cookie") continue;

      assert.ok(!value.includes(MINTED), `the minted session's value reached the ${name} header`);
    }
  });
});
