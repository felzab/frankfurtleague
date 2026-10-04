import "server-only";

import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import { calculateJwkThumbprint, SignJWT } from "jose";

import { BootRefusal } from "./bootRefusal";
import { frontend_config } from "./config";
import { asSignInIdentifier } from "./emailAddress";
import { formatLogLine } from "./logFormat";

import type { KeyObject } from "node:crypto";
import type { ActorLane, RequestActor } from "./requestScope";

// RFC 8725 §3.11's explicit typing: a JWT this key signs for any other purpose never passes for an
// actor, and the backend refuses one lacking it.
const ACTOR_TOKEN_TYPE = "fl-actor+jwt";
const ACTOR_TOKEN_ISSUER = "fl-frontend";
const ACTOR_TOKEN_AUDIENCE = "fl-backend";

// Short, as NIST SP 800-204 MS-SS-1 asks of an internal token, and still above the request deadline
// (`fl_frontend/src/core/requestScope.ts :: REQUEST_DEADLINE_MS`), so the token a guard minted
// serves every call of its request.
const ACTOR_TOKEN_LIFETIME_S = 60;

/** The private key, and the RFC 7638 thumbprint of its public half, which the backend matches `kid` to. */
export type SigningKey = { readonly key: KeyObject; readonly kid: string };

/** As much of a served session as the token states. */
export type ActorSource = {
  readonly user: { readonly id: string; readonly email: string };
  readonly session: { readonly id: string; readonly createdAt: Date | string; readonly authFactor?: unknown };
};

/** The claims beside the registered ones, spelled as the backend reads them. */
export type ActorClaims = {
  readonly sub: string;
  readonly email: string;
  readonly sid: string;
  readonly amr: readonly ["passkey"] | readonly ["code"];
  readonly auth_time: number;
  readonly lane: ActorLane;
};

/** A key file the boot or a mint could not use. The message names the path and never the contents. */
export class ActorSigningKeyError extends Error {
  override name = "ActorSigningKeyError";
  readonly path: string;
  readonly reason: string;

  constructor(path: string, reason: string) {
    super(`The actor signing key at ${path} ${reason}.`);
    this.path = path;
    this.reason = reason;
  }
}

/**
 * `null` where the session cannot be stated truthfully: no address to fold, an unreadable creation
 * stamp, or a factor this league does not mint. The guard then answers no session.
 */
export function actorClaimsOf(source: ActorSource, lane: ActorLane): ActorClaims | null {
  const email = asSignInIdentifier(source.user.email);
  const authTime = Math.floor(new Date(source.session.createdAt).getTime() / 1000);
  // The session's own stamp (`fl_frontend/src/core/auth.ts :: SESSION_FACTOR_BY_PATH`), as a private
  // `amr` value: RFC 8176 registers no passkey.
  const factor = source.session.authFactor;

  if (email === "" || !Number.isFinite(authTime)) return null;
  if (factor !== "passkey" && factor !== "code") return null;

  return { sub: source.user.id, email: email, sid: source.session.id, amr: [factor], auth_time: authTime, lane: lane };
}

/** The compact JWS the backend verifies, issued at `issuedAt` in whole seconds. */
export function mintActorToken(signing: SigningKey, claims: ActorClaims, issuedAt: number): Promise<string> {
  return (
    new SignJWT({ email: claims.email, sid: claims.sid, amr: [...claims.amr], auth_time: claims.auth_time, lane: claims.lane })
      // EdDSA alone, the one algorithm the backend allows (RFC 8725 §3.1, RFC 8037).
      .setProtectedHeader({ alg: "EdDSA", typ: ACTOR_TOKEN_TYPE, kid: signing.kid })
      .setIssuer(ACTOR_TOKEN_ISSUER)
      .setAudience(ACTOR_TOKEN_AUDIENCE)
      .setSubject(claims.sub)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ACTOR_TOKEN_LIFETIME_S)
      // Named on no line but the backend's refusal of a request this token carried
      // (`docs/logging/spec.md`), and never checked for a replay: the lifetime bounds one, and no
      // cache of seen ids is kept.
      .setJti(randomBytes(16).toString("base64url"))
      .sign(signing.key)
  );
}

/** Reads an Ed25519 private key in "PKCS#8" PEM; anything else refuses, naming why. */
export async function loadSigningKey(path: string): Promise<SigningKey> {
  let pem: string;
  try {
    pem = await readFile(path, "utf8");
  } catch (error) {
    throw new ActorSigningKeyError(
      path,
      error instanceof Error && "code" in error && error.code === "ENOENT" ? "does not exist" : "could not be read",
    );
  }

  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: "pem" });
  } catch {
    // The parser's own error is dropped rather than chained: nothing proves it quotes none of the file.
    throw new ActorSigningKeyError(path, "holds no readable PEM private key");
  }
  if (key.asymmetricKeyType !== "ed25519") throw new ActorSigningKeyError(path, "holds a key that is not Ed25519");

  return { key: key, kid: await calculateJwkThumbprint(createPublicKey(key)) };
}

/** Each key file read once, by the path the configuration names. */
const signingKeys = new Map<string, Promise<SigningKey>>();

// Read at the first use rather than at import: `next build` imports this module and holds no key file.
function actorSigningKey(): Promise<SigningKey> {
  const path = frontend_config.ACTOR_SIGNING_KEY_FILE;
  let loaded = signingKeys.get(path);
  if (loaded === undefined) {
    loaded = loadSigningKey(path);
    signingKeys.set(path, loaded);
  }

  return loaded;
}

/**
 * The boot's read of the key, so a file missing or unusable refuses the start rather than the first
 * signed-in request. Written straight to the stream at `CRITICAL`, as the environment gate's refusal is.
 */
export async function loadActorSigningKeyAtBoot(): Promise<void> {
  try {
    await actorSigningKey();
  } catch (error) {
    const meta = {
      error_code: "FE-BOOT-003",
      path: frontend_config.ACTOR_SIGNING_KEY_FILE,
      reason: error instanceof ActorSigningKeyError ? error.reason : "could not be loaded",
    };
    process.stdout.write(formatLogLine(frontend_config.LOG_FORMAT, "CRITICAL", "The actor signing key could not be loaded", meta) + "\n");

    // A file the key cannot be read from is a refusal of what the container was handed; anything else
    // failing here is a fault of the build, which the deploy's preflight must not report as the host's.
    throw error instanceof ActorSigningKeyError ? new BootRefusal(error.message) : error;
  }
}

/**
 * The actor a guard records for this request, `null` where `actorClaimsOf` refuses the session. Never
 * handed to a response, a cookie or a log line: the token is a bearer credential for its lifetime.
 */
export async function mintRequestActor(source: ActorSource, lane: ActorLane): Promise<RequestActor | null> {
  const claims = actorClaimsOf(source, lane);
  if (claims === null) return null;

  // One reading of the clock for both stamps: the backend refuses a token whose `exp` lies more than
  // sixty seconds past its `iat`.
  const token = await mintActorToken(await actorSigningKey(), claims, Math.floor(Date.now() / 1000));

  return { email: claims.email, lane: lane, token: token };
}
