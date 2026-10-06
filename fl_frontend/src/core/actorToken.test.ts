import assert from "node:assert/strict";
import { createHash, createPrivateKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { CompactSign, decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { z } from "zod";

import { ACTOR_KEY_FILE as KEY_FILE, ACTOR_KEY_PAIR as PAIR } from "./authDoubles.ts";
import { registerDoubles } from "./exportingModule.ts";

import type { KeyObject } from "node:crypto";
import type { ActorLane } from "./requestScope.ts";

/** Where the refused files go, removed after the run. */
const DIRECTORY = mkdtempSync(path.join(tmpdir(), "fl-actor-token-"));
after(() => rmSync(DIRECTORY, { recursive: true, force: true }));

const CONFIG_DOUBLE = { frontend_config: { ACTOR_SIGNING_KEY_FILE: KEY_FILE, LOG_FORMAT: "json" } };

registerDoubles({
  modules: {
    "core/config.ts": CONFIG_DOUBLE,
  },
});

const { actorClaimsOf, ActorSigningKeyError, loadSigningKey, mintActorToken, mintRequestActor } = await import("./actorToken.ts");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

// Read rather than retyped: the backend's verifier is held to the same table in its own suite and its
// test signer mints from it, so a value changed on one side alone fails a suite rather than production.
const CONTRACT = z
  .object({
    alg: z.string(),
    typ: z.string(),
    header: z.array(z.string()),
    iss: z.string(),
    aud: z.string(),
    lifetime_s: z.number().int(),
    claims: z.array(z.string()),
    lanes: z.array(z.string()),
    factors: z.array(z.string()),
    admin_factor: z.string(),
  })
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "actor_token_contract.json"), "utf8")));

// Every lane this runtime mints: `satisfies` refuses a lane added to or dropped from `ActorLane` without
// this record, so the comparison with the table cannot pass over one.
const MINTED_LANES = { admin: true, person: true } as const satisfies Record<ActorLane, true>;

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

    const header = decodeProtectedHeader(token);

    assert.deepEqual(Object.keys(header).sort(), [...CONTRACT.header].sort());
    assert.deepEqual(header, { alg: CONTRACT.alg, typ: CONTRACT.typ, kid: thumbprintOf(PAIR.publicKey) });
  });

  /* Every claim the backend requires, each spelled as it reads it: one missing or renamed refuses every
     write the lane makes. */
  it("carries every claim, and expires the contract's lifetime after it was issued", async () => {
    const signing = await loadSigningKey(KEY_FILE);
    const minted = decodeJwt(await mintActorToken(signing, claimsFor("admin"), ISSUED_AT));
    const { jti, ...payload } = minted;

    assert.deepEqual(Object.keys(minted).sort(), [...CONTRACT.claims].sort());
    assert.deepEqual(payload, {
      iss: CONTRACT.iss,
      aud: CONTRACT.aud,
      sub: "user-row-id",
      email: "vorstand@example.org",
      sid: "session-row-id",
      amr: [CONTRACT.admin_factor],
      auth_time: Math.floor(CREATED_AT.getTime() / 1000),
      lane: "admin",
      iat: ISSUED_AT,
      exp: ISSUED_AT + CONTRACT.lifetime_s,
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
      algorithms: [CONTRACT.alg],
      typ: CONTRACT.typ,
      issuer: CONTRACT.iss,
      audience: CONTRACT.aud,
      currentDate: new Date((ISSUED_AT + 30) * 1000),
    });
    assert.equal(payload.lane, "person");

    const other = generateKeyPairSync("ed25519");
    await assert.rejects(jwtVerify(token, other.publicKey, { algorithms: ["EdDSA"], currentDate: new Date((ISSUED_AT + 30) * 1000) }));
  });
});

describe("the claims a session is stated by", () => {
  it("names the lane of the guard that minted it, each of those the backend verifies", () => {
    assert.deepEqual(Object.keys(MINTED_LANES).sort(), [...CONTRACT.lanes].sort());
    for (const lane of Object.keys(MINTED_LANES) as ActorLane[]) assert.equal(claimsFor(lane).lane, lane);
  });

  /* The session's own factor, never what the account holds: a code-borne session of an address holding
     a passkey is a code session. */
  it("states the factor that made the session, each of those the contract names", () => {
    for (const authFactor of CONTRACT.factors) {
      assert.deepEqual(actorClaimsOf({ ...SOURCE, session: { ...SOURCE.session, authFactor } }, "person")?.amr, [authFactor], authFactor);
    }
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

  /* RFC 8037's key and vectors, Appendix A.1, A.3 and A.4, read on 2026-09-27. The backend verifies
     with another library, so the published vectors are what both halves agree to; Ed25519 makes the
     A.4 signature deterministic. */
  it("reads RFC 8037's example key to the RFC's thumbprint, and signs its example to the RFC's JWS", async () => {
    const file = path.join(DIRECTORY, "rfc8037.pem");
    const rfcKey = createPrivateKey({
      key: { kty: "OKP", crv: "Ed25519", d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" },
      format: "jwk",
    });
    writeFileSync(file, rfcKey.export({ type: "pkcs8", format: "pem" }));

    const signing = await loadSigningKey(file);
    const jws = await new CompactSign(new TextEncoder().encode("Example of Ed25519 signing"))
      .setProtectedHeader({ alg: "EdDSA" })
      .sign(signing.key);

    assert.equal(signing.kid, "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k");
    assert.equal(
      jws,
      "eyJhbGciOiJFZERTQSJ9.RXhhbXBsZSBvZiBFZDI1NTE5IHNpZ25pbmc.hgyY0il_MGCjP0JzlnLWG1PPOt7-09PGcvMg3AIbQR6dWbhijcNR4ki4iylGjg5BhVsPt9g7sVvpAr_MuM0KAg",
    );
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

  /* The backend allows EdDSA alone, so a key of another curve would mint tokens every request is refused.
     X25519 beside P-256: the one curve sharing Ed25519's JWK key type, which a check of the type passes. */
  it("refuses a private key that is not Ed25519", async () => {
    const keys = {
      "p256.pem": generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey,
      "x25519.pem": generateKeyPairSync("x25519").privateKey,
    };

    for (const [name, key] of Object.entries(keys)) {
      const file = path.join(DIRECTORY, name);
      writeFileSync(file, key.export({ type: "pkcs8", format: "pem" }));

      await assert.rejects(
        loadSigningKey(file),
        (error: unknown) => error instanceof ActorSigningKeyError && error.reason === "holds a key that is not Ed25519",
        `${name} was taken for a signing key`,
      );
    }
  });
});

describe("the actor a guard records", () => {
  it("is the folded address, the lane, and a token signed with the configured key", async () => {
    const actor = await mintRequestActor(SOURCE, "admin");
    assert.ok(actor);

    assert.equal(actor.email, "vorstand@example.org");
    assert.equal(actor.lane, "admin");
    const { payload } = await jwtVerify(actor.token, PAIR.publicKey, { algorithms: [CONTRACT.alg], typ: CONTRACT.typ });
    assert.equal(payload.exp, Number(payload.iat) + CONTRACT.lifetime_s);
  });

  /* The backend refuses a token living longer than sixty seconds, so both stamps come from one reading
     of the clock: a second reading across a second's edge would issue one living sixty-one. */
  it("stamps issue and expiry off one reading of the clock, even across a second's edge", async (t) => {
    const readings = [1790000000999, 1790000001000, 1790000001001];
    t.mock.method(Date, "now", () => readings.shift() ?? 1790000001002);

    const actor = await mintRequestActor(SOURCE, "admin");
    assert.ok(actor);
    const { iat, exp } = decodeJwt(actor.token);

    assert.equal(iat, 1790000000);
    assert.equal(exp, 1790000060);
  });

  it("is none where the claims refuse the session", async () => {
    assert.equal(await mintRequestActor({ ...SOURCE, session: { ...SOURCE.session, authFactor: "link" } }, "person"), null);
  });
});
