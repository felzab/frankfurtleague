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
});
