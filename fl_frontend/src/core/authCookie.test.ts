import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADMIN_EMAIL, configDouble, memoryAdapterDouble, registerAuthDoubles, seedLink } from "./authDoubles.ts";

const STORE = "__flAuthCookieStore";

/** A served origin over https, which is what production and every non-local stack run on. */
const HTTPS_ORIGIN = "https://liga.example";

const globals = globalThis as unknown as Record<string, unknown>;
const store = { user: [], session: [], account: [], verification: [] as { identifier: string }[], passkey: [] };
globals[STORE] = store;

registerAuthDoubles({
  core: { config: configDouble({ AUTH_URL: HTTPS_ORIGIN }) },
  specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) },
});

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { auth } = await import("./auth.ts");

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
    const verified = await auth.api.magicLinkVerify({
      query: { token: seedLink(store.verification, ADMIN_EMAIL) },
      headers: new Headers(HEADERS),
      returnHeaders: true,
    });

    const written = cookiesOf(verified);
    const session = written.find((cookie) => cookie.name.endsWith(".session_token"));
    assert.ok(session, `no session cookie among ${written.map((cookie) => cookie.name).join(", ")}`);

    assert.equal(session.name, "__Host-auth.session_token");
    assert.ok(session.attributes.includes("secure"), "the host-bound cookie travels over plain http too");
    assert.ok(session.attributes.includes("path=/"));
    assert.ok(!session.attributes.some((attribute) => attribute.startsWith("domain=")), "the cookie reaches other hosts");
  });

  /* The passkey challenge rides the same prefix, so it keeps `Secure` with the session's. */
  it("host-binds the passkey challenge cookie as well", async () => {
    const offered = await auth.api.generatePasskeyAuthenticationOptions({ headers: new Headers(HEADERS), returnHeaders: true });

    const [challenge] = cookiesOf(offered);
    assert.ok(challenge?.name.startsWith("__Host-auth."), `the challenge cookie is ${String(challenge?.name)}`);
    assert.ok(challenge.attributes.includes("secure"));
  });
});
