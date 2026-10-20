import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADMIN_EMAIL,
  configDouble,
  cookieHeader,
  memoryAdapterDouble,
  memoryStore,
  registerAuthDoubles,
  signInByCode,
} from "./core/authDoubles.ts";

const STORE = "__flProxyCookieStore";

/** A served origin over https, which production and every non-local stack run on. */
const HTTPS_ORIGIN = "https://liga.example";

memoryStore(STORE);

/* Its own process: over http the configured prefix and the library's default are one name, so no case in
   `fl_frontend/src/proxy.test.ts` can tell the proxy's check reads the configured one. */
registerAuthDoubles({
  core: { config: configDouble({ AUTH_URL: HTTPS_ORIGIN }) },
  specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { auth, sessionCookieOf } = await import("./core/auth.ts");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
const { config } = await import("./proxy.ts");

const HEADERS = { host: "liga.example", "x-forwarded-proto": "https" };

describe("the proxy's session cookie over https (`docs/frontend/spec.md :: I243`)", () => {
  /* Read under the library's default name, it would find nothing a signed-in person carries in production,
     and the proxy would send every one of them to sign in. */
  it("is the cookie the library writes there", async () => {
    const written = cookieHeader(await signInByCode(auth, ADMIN_EMAIL, HEADERS));
    // The control: the name is the host-bound one, which the default prefix does not spell.
    assert.ok(written.includes("__Host-"), `the sign-in wrote ${written}`);

    assert.notEqual(sessionCookieOf(new Headers({ ...HEADERS, cookie: written })), null, "the proxy's check finds no session cookie");
  });

  // Under the default name a cookie the library never writes there, which a sibling subdomain could plant.
  it("is not the library's default name", () => {
    const planted = new Headers({ ...HEADERS, cookie: "better-auth.session_token=fremd" });

    assert.equal(sessionCookieOf(planted), null, "the proxy's check reads a name this origin never writes");
  });

  // The library reads `__Secure-<name>` ahead of `<name>`, and a sibling subdomain can set that spelling where the
  // host-bound one is refused it.
  it("is not the `__Secure-` spelling of its name, which this origin never writes", async () => {
    const written = cookieHeader(await signInByCode(auth, ADMIN_EMAIL, HEADERS));
    const name = /__Host-[^=]*\.session_token/.exec(written)?.[0] ?? assert.fail(`the sign-in wrote ${written}`);
    const planted = `__Secure-${name}=fremd`;

    assert.equal(sessionCookieOf(new Headers({ ...HEADERS, cookie: planted })), null, "the proxy's check reads a planted spelling");
    // Beside the host-bound cookie, the one this origin wrote is still read.
    assert.notEqual(sessionCookieOf(new Headers({ ...HEADERS, cookie: `${planted}; ${written}` })), null);
  });
});

/* The matcher spells the cookie by its suffix alone: a prefix it did not foresee, the host-bound one among them,
   would run the proxy on every signed-in prefetch and slide its session (`docs/frontend/spec.md :: I495`). */
describe("the proxy's matcher over https", () => {
  it("skips a prefetch carrying the session cookie the library writes there, and runs on one carrying none", async () => {
    const written = cookieHeader(await signInByCode(auth, ADMIN_EMAIL, HEADERS));
    const cookies = Object.fromEntries(written.split("; ").map((pair) => pair.split(/=(.*)/s, 2)));
    const runs = (carried: Record<string, string>): boolean =>
      unstable_doesMiddlewareMatch({
        config,
        url: `${HTTPS_ORIGIN}/bereich/konto`,
        headers: { "next-router-prefetch": "1" },
        cookies: carried,
      });

    assert.ok(
      Object.keys(cookies).some((name) => name.startsWith("__Host-")),
      `the sign-in wrote ${written}`,
    );
    assert.equal(runs(cookies), false, "the proxy runs on a signed-in prefetch, sliding the session");
    assert.equal(runs({}), true, "the control: a signed-out prefetch skips the proxy as well, so the case above reads nothing");
  });
});
