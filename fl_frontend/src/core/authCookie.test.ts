// The class Next's own `cookies()` writes a response's cookies with.
import { ResponseCookies } from "next/dist/server/web/spec-extension/cookies.js";

import { assert, describe, expect, it } from "vitest";

import {
  ADMIN_EMAIL,
  configDouble,
  cookieHeader,
  cookiePair,
  memoryAdapterDouble,
  memoryStore,
  registerAuthDoubles,
  signInByCode,
} from "@/test-support/authDoubles";

const STORE = "__flAuthCookieStore";

/** A served origin over https, which is what production and every non-local stack run on. */
const HTTPS_ORIGIN = "https://liga.example";

memoryStore(STORE);

/* Its own process: over http the configured prefix and the library's default are one name, so no case in
   `fl_frontend/src/proxy.test.ts` can tell the proxy's check reads the configured one. */
registerAuthDoubles({
  core: { config: configDouble({ AUTH_URL: HTTPS_ORIGIN }) },
  specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { auth, codeAskedCookie, sessionCookieOf } = await import("./auth/library");
const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
const { config } = await import("../proxy");

const HEADERS = { host: "liga.example", "x-forwarded-proto": "https" };

/** The `Set-Cookie` lines one in-process call wrote, parsed into a name and its attributes. */
function cookiesOf(answer: { headers: Headers }): { name: string; attributes: string[] }[] {
  return answer.headers.getSetCookie().map((line) => {
    const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
    return { name: pair.slice(0, pair.indexOf("=")), attributes: attributes.map((attribute) => attribute.toLowerCase()) };
  });
}

/* A `__Host-` cookie is bound to the exact host that set it: a sibling subdomain cannot plant or
   overwrite it. The library would prefix `__Secure-` to any configured name, which binds no host. */
describe("the session cookie over https", () => {
  it("is host-bound: `__Host-`, `Secure`, `Path=/` and no `Domain`", async () => {
    const verified = await signInByCode(auth, ADMIN_EMAIL, HEADERS);

    const written = cookiesOf(verified);
    const session = written.find((cookie) => cookie.name.endsWith(".session_token"));
    assert.ok(session, `no session cookie among ${written.map((cookie) => cookie.name).join(", ")}`);

    expect(session.name).toBe("__Host-auth.session_token");
    assert.ok(session.attributes.includes("secure"), "the host-bound cookie travels over plain http too");
    assert.ok(session.attributes.includes("path=/"));
    assert.ok(!session.attributes.some((attribute) => attribute.startsWith("domain=")), "the cookie reaches other hosts");
  });

  /* The passkey challenge rides the same prefix, so it keeps `Secure` with the session's. */
  it("host-binds the passkey challenge cookie as well", async () => {
    const offered = await auth.api.generatePasskeyAuthenticationOptions({ headers: new Headers(HEADERS), returnHeaders: true });

    const [challenge] = cookiesOf(offered);
    assert.ok(challenge, "the options call set no cookie");
    assert.ok(challenge.name.startsWith("__Host-auth."), `the challenge cookie is ${challenge.name}`);
    assert.ok(challenge.attributes.includes("secure"));
  });

  /* The sign-in action sets this one through Next's `cookies()`, which, unlike the library's own setter, adds no
     `Secure` to a `__Host-` name: a browser drops such a cookie, and every typed code would then be refused. */
  it("host-binds the code's ask cookie as well", async () => {
    const { name, value, options } = await codeAskedCookie(ADMIN_EMAIL);
    // Written as Next's `cookies().set` writes it onto the response.
    const response = new Headers();
    new ResponseCookies(response).set(name, value, options);

    const [asked] = cookiesOf({ headers: response });
    assert.ok(asked, "no cookie was written");
    assert.ok(asked.name.startsWith("__Host-auth."), `the ask's cookie is ${asked.name}`);
    assert.ok(asked.attributes.includes("secure"), "the host-bound cookie lacks `Secure`, so a browser drops it");
    assert.ok(asked.attributes.includes("path=/"));
    assert.ok(!asked.attributes.some((attribute) => attribute.startsWith("domain=")), "the cookie reaches other hosts");
  });
});

describe("the proxy's session cookie over https", () => {
  // Under the default name a cookie the library never writes there, which a sibling subdomain could plant.
  it("is not the library's default name", () => {
    const planted = new Headers({ ...HEADERS, cookie: "better-auth.session_token=fremd" });

    expect(sessionCookieOf(planted), "the proxy's check reads a name this origin never writes").toBe(null);
  });

  // The library reads `__Secure-<name>` ahead of `<name>`, and a sibling subdomain can set that spelling where the
  // host-bound one is refused it.
  it("is not the `__Secure-` spelling of its name, which this origin never writes", async () => {
    const written = cookieHeader(await signInByCode(auth, ADMIN_EMAIL, HEADERS));
    const name = /__Host-[^=]*\.session_token/.exec(written)?.[0] ?? assert.fail(`the sign-in wrote ${written}`);
    const planted = `__Secure-${name}=fremd`;

    expect(sessionCookieOf(new Headers({ ...HEADERS, cookie: planted })), "the proxy's check reads a planted spelling").toBe(null);
    // Beside the host-bound cookie, the one this origin wrote is still read.
    expect(sessionCookieOf(new Headers({ ...HEADERS, cookie: `${planted}; ${written}` }))).not.toBe(null);
  });
});

/* The matcher spells the cookie by its suffix alone: a prefix it did not foresee, the host-bound one among them,
   would run the proxy on every signed-in prefetch and slide its session. */
describe("the proxy's matcher over https", () => {
  it("skips a prefetch carrying the session cookie the library writes there, and runs on one carrying none", async () => {
    const written = cookieHeader(await signInByCode(auth, ADMIN_EMAIL, HEADERS));
    const cookies = Object.fromEntries(written.split("; ").map(cookiePair));
    const runs = (carried: Record<string, string>): boolean =>
      unstable_doesMiddlewareMatch({
        config,
        url: `${HTTPS_ORIGIN}/account`,
        headers: { "next-router-prefetch": "1" },
        cookies: carried,
      });

    assert.ok(
      Object.keys(cookies).some((name) => name.startsWith("__Host-")),
      `the sign-in wrote ${written}`,
    );
    expect(runs(cookies), "the proxy runs on a signed-in prefetch, sliding the session").toBe(false);
    expect(runs({}), "the control: a signed-out prefetch skips the proxy as well, so the case above reads nothing").toBe(true);
  });
});
