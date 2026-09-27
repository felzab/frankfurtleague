import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";

import { ACTOR_KEY_FILE as KEY_FILE, ACTOR_KEY_PAIR as PAIR } from "./authDoubles.ts";
import { exportingModule } from "./exportingModule.ts";

import type { KeyObject } from "node:crypto";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** Where the refused files go, removed after the run. */
const DIRECTORY = mkdtempSync(path.join(tmpdir(), "fl-actor-token-"));
after(() => rmSync(DIRECTORY, { recursive: true, force: true }));

const CONFIG_DOUBLE = exportingModule({ frontend_config: { ACTOR_SIGNING_KEY_FILE: KEY_FILE, LOG_FORMAT: "json" } });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { actorClaimsOf, ActorSigningKeyError, loadSigningKey, mintActorToken, mintRequestActor } = await import("./actorToken.ts");

/**
 * RFC 7638's thumbprint of an Ed25519 public key, reckoned here from the RFC rather than by the library
 * the module signs with: the required members in lexicographic order, no whitespace, SHA-256, base64url.
 */
function thumbprintOf(publicKey: KeyObject): string {
  const { crv, kty, x } = publicKey.export({ format: "jwk" });

  return createHash("sha256")
    .update(JSON.stringify({ crv: crv, kty: kty, x: x }))
    .digest("base64url");
}

const CREATED_AT = new Date("2026-09-27T08:00:00.500Z");
const SOURCE = {
  user: { id: "user-row-id", email: "Vorstand@Example.org" },
  session: { id: "session-row-id", createdAt: CREATED_AT, authFactor: "passkey" },
};
const ISSUED_AT = 1790000000;

/** The claims `actorClaimsOf` answers for `SOURCE` under `lane`, which every case below has to be answered. */
function claimsFor(lane: "admin" | "person"): NonNullable<ReturnType<typeof actorClaimsOf>> {
  const claims = actorClaimsOf(SOURCE, lane);
  assert.ok(claims, "the source was refused, so the case compares nothing");

  return claims;
}

describe("the token a guard mints", () => {
  it("carries exactly the protected header the backend checks: EdDSA, the explicit type and the key's thumbprint", async () => {
    const signing = await loadSigningKey(KEY_FILE);
    const token = await mintActorToken(signing, claimsFor("admin"), ISSUED_AT);

    assert.deepEqual(decodeProtectedHeader(token), { alg: "EdDSA", typ: "fl-actor+jwt", kid: thumbprintOf(PAIR.publicKey) });
  });

  /* Every claim the backend requires, each spelled as it reads it: one missing or renamed refuses every
     write the lane makes. */
  it("carries every claim, and expires sixty seconds after it was issued", async () => {
    const signing = await loadSigningKey(KEY_FILE);
    const { jti, ...payload } = decodeJwt(await mintActorToken(signing, claimsFor("admin"), ISSUED_AT));

    assert.deepEqual(payload, {
      iss: "fl-frontend",
      aud: "fl-backend",
      sub: "user-row-id",
      email: "vorstand@example.org",
      sid: "session-row-id",
      amr: ["passkey"],
      auth_time: Math.floor(CREATED_AT.getTime() / 1000),
      lane: "admin",
      iat: ISSUED_AT,
      exp: ISSUED_AT + 60,
    });
    assert.match(String(jti), /^[A-Za-z0-9_-]{22}$/, "the id is not 128 bits in base64url");
    assert.equal(Buffer.from(String(jti), "base64url").length, 16);
  });

  it("gives every token an id of its own", async () => {
    const signing = await loadSigningKey(KEY_FILE);
    const ids = await Promise.all([1, 2, 3].map(async () => decodeJwt(await mintActorToken(signing, claimsFor("admin"), ISSUED_AT)).jti));

    assert.equal(new Set(ids).size, 3);
  });

  /* The check the backend runs, with the one algorithm it allows: a token this fails is refused there. */
  it("verifies against the public half alone, under the issuer, audience and type the backend demands", async () => {
    const signing = await loadSigningKey(KEY_FILE);
    const token = await mintActorToken(signing, claimsFor("person"), ISSUED_AT);

    const { payload } = await jwtVerify(token, PAIR.publicKey, {
      algorithms: ["EdDSA"],
      typ: "fl-actor+jwt",
      issuer: "fl-frontend",
      audience: "fl-backend",
      currentDate: new Date((ISSUED_AT + 30) * 1000),
    });
    assert.equal(payload.lane, "person");

    const other = generateKeyPairSync("ed25519");
    await assert.rejects(jwtVerify(token, other.publicKey, { algorithms: ["EdDSA"], currentDate: new Date((ISSUED_AT + 30) * 1000) }));
  });
});

describe("the claims a session is stated by", () => {
  it("names the lane of the guard that minted it", () => {
    assert.equal(claimsFor("admin").lane, "admin");
    assert.equal(claimsFor("person").lane, "person");
  });

  /* The session's own factor, never what the account holds: a code-borne session of an address holding
     a passkey is a code session. */
  it("states the factor that made the session, each of the two this league mints", () => {
    assert.deepEqual(actorClaimsOf(SOURCE, "person")?.amr, ["passkey"]);
    assert.deepEqual(actorClaimsOf({ ...SOURCE, session: { ...SOURCE.session, authFactor: "code" } }, "person")?.amr, ["code"]);
  });

  /* A token cannot state a factor the session did not prove, nor an address or an age nobody can read. */
  it("refuses a session it cannot state truthfully", () => {
    for (const authFactor of ["link", undefined, "PASSKEY"]) {
      assert.equal(actorClaimsOf({ ...SOURCE, session: { ...SOURCE.session, authFactor } }, "person"), null, String(authFactor));
    }
    assert.equal(actorClaimsOf({ ...SOURCE, user: { ...SOURCE.user, email: "" } }, "person"), null);
    assert.equal(actorClaimsOf({ ...SOURCE, session: { ...SOURCE.session, createdAt: "kein Datum" } }, "person"), null);
  });

  it("takes a creation stamp the adapter answered as a string", () => {
    assert.equal(
      actorClaimsOf({ ...SOURCE, session: { ...SOURCE.session, createdAt: CREATED_AT.toISOString() } }, "admin")?.auth_time,
      Math.floor(CREATED_AT.getTime() / 1000),
    );
  });
});

describe("the key file", () => {
  it("yields the key and the thumbprint of its public half", async () => {
    const signing = await loadSigningKey(KEY_FILE);

    assert.equal(signing.kid, thumbprintOf(PAIR.publicKey));
  });

  /* The refusal is read on a boot line and in a crash report: it names where to look and never what
     the file holds. */
  it("refuses a file that is missing, naming its path", async () => {
    const missing = path.join(DIRECTORY, "absent.pem");

    await assert.rejects(loadSigningKey(missing), (error: unknown) => {
      assert.ok(error instanceof ActorSigningKeyError);
      assert.equal(error.path, missing);
      assert.equal(error.reason, "does not exist");
      assert.ok(error.message.includes(missing));
      return true;
    });
  });

  it("refuses a path it cannot read as a file", async () => {
    await assert.rejects(
      loadSigningKey(DIRECTORY),
      (error: unknown) => error instanceof ActorSigningKeyError && error.reason === "could not be read",
    );
  });

  it("refuses a file holding no key, never quoting what it holds", async () => {
    // One short mark repeated, so any fragment of the file seven characters long carries it whole.
    const mark = "Q7xZ";
    const held = mark.repeat(40);
    const file = path.join(DIRECTORY, "garbage.pem");
    writeFileSync(file, held);

    await assert.rejects(loadSigningKey(file), (error: unknown) => {
      assert.ok(error instanceof ActorSigningKeyError);
      assert.equal(error.reason, "holds no readable PEM private key");
      assert.ok(
        !JSON.stringify({ message: error.message, stack: error.stack, cause: error.cause }).includes(mark),
        "the refusal quoted the file",
      );
      return true;
    });
  });

  /* The backend allows EdDSA alone, so a key of another curve would mint tokens every request is refused. */
  it("refuses a private key that is not Ed25519", async () => {
    const file = path.join(DIRECTORY, "p256.pem");
    writeFileSync(file, generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }));

    await assert.rejects(
      loadSigningKey(file),
      (error: unknown) => error instanceof ActorSigningKeyError && error.reason === "holds a key that is not Ed25519",
    );
  });
});

describe("the actor a guard records", () => {
  it("is the folded address, the lane, and a token signed with the configured key", async () => {
    const actor = await mintRequestActor(SOURCE, "admin");
    assert.ok(actor);

    assert.equal(actor.email, "vorstand@example.org");
    assert.equal(actor.lane, "admin");
    const { payload } = await jwtVerify(actor.token, PAIR.publicKey, { algorithms: ["EdDSA"], typ: "fl-actor+jwt" });
    assert.equal(payload.exp, Number(payload.iat) + 60);
  });

  it("is none where the claims refuse the session", async () => {
    assert.equal(await mintRequestActor({ ...SOURCE, session: { ...SOURCE.session, authFactor: "link" } }, "person"), null);
  });
});
