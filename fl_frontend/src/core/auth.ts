import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth, getCurrentAdapter } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { MongoServerError } from "mongodb";

import { mintRequestActor } from "./actorToken";
import { ANMELDUNG_CODE, ANMELDUNG_TAG } from "./anmeldeTag";
import { buildCodeEmail, CODE_VALIDITY_MINUTES } from "./authEmail";
import { MONGO_DB_NAME } from "./authIndexes";
import { authSecret, frontend_config } from "./config";
import { signInStore } from "./db";
import { asSignInIdentifier } from "./emailAddress";
import { BRAND_NAME } from "./emailShell";
import { RolledBackError } from "./errors";
import { KONTO_HREF } from "./kontoHref";
import { logger } from "./logging";
import { sendMail } from "./mail";
import { declaredCredentialId, PASSKEY_ASSERTION_PATH } from "./passkeyCeremony";
import { buildPasskeyGeloeschtEmail, buildPasskeyHinzugefuegtEmail } from "./passkeyEmail";
import { passkeyLastUse } from "./passkeyLastUse";
import { SIGN_IN_BARRED, SIGN_IN_HOLDS_NOTHING, USER_VERIFICATION_REFUSED } from "./passkeyRefusal";
import { oncePerRequest, setRequestActor } from "./requestScope";
import {
  ADMIN_LIFETIME,
  isWithinEnrolmentWindow,
  isWithinStepUpWindow,
  PERSON_LIFETIME,
  SESSION_EXPIRES_IN_DAYS,
  STEP_UP_WINDOW_MS,
} from "./sessionLifetimes";
import { CODE_FAILURE_LIMIT, CODE_FAILURE_WINDOW_HOURS, CODE_MAIL_LIMIT, CODE_MAIL_WINDOW_HOURS, SIGN_IN_CODE_LENGTH } from "./signInCode";
import { lookUpAnmeldung, lookUpSubjekt, mayReceiveSignIn, signInVerdictOf } from "./signInGate";
import { versandAusfallOf } from "./versandAusfall";
import { madeSince, verwaltungOf } from "./verwaltung";

import type { Passkey } from "@better-auth/passkey";
import type { AuthContext, BetterAuthOptions, DBTransactionAdapter, GenericEndpointContext } from "better-auth";
import type { MongoClient } from "mongodb";
import type { PasskeyEmail } from "./passkeyEmail";
import type { RequestActor } from "./requestScope";
import type { Lifetime } from "./sessionLifetimes";
import type { AnmeldungRecords } from "./signInGate";
import type { SubjectSession } from "./subject";
import type { Verwaltung } from "./verwaltung";

// A ceiling nothing else supplies: one session that passed the assertion can enrol without limit
// (`docs/frontend/spec.md :: I311`).
export const PASSKEY_LIMIT = 5;

const SESSION_EXPIRES_IN_SECONDS = SESSION_EXPIRES_IN_DAYS * 24 * 60 * 60;

// What the refresh costs, and so how closely `updatedAt` tracks activity: the idle windows in
// `fl_frontend/src/core/sessionLifetimes.ts` are compared against it, and this is the width of their
// granularity.
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

const CODE_VALIDITY_SECONDS = CODE_VALIDITY_MINUTES * 60;

/** How the plugin names a sign-in code's row: its type, then the address (`email-otp/utils :: toOTPIdentifier`). */
const CODE_ROW_PREFIX = "sign-in-otp-";

// The newest stamp this process gave a new sign-in code, which the next one's passes. Held in memory:
// one process serves the league, and a second would order only its own codes.
let lastCodeStamp = 0;

/** How far past its issue time a code's stamp may be moved: a clock set back never lengthens a code's life by more. */
const CODE_STAMP_SLACK_MS = 1000;

/**
 * A new code's stamp, strictly after every other this process gave: the plugin takes the newest stamp for
 * the live code and breaks a tie by nothing, so two codes issued inside one millisecond would leave either live.
 */
function nextCodeStamp(issued: number): number {
  const stamp = issued <= lastCodeStamp && lastCodeStamp - issued < CODE_STAMP_SLACK_MS ? lastCodeStamp + 1 : issued;
  lastCodeStamp = stamp;
  return stamp;
}

/** The one path that spends a code, which `fl_frontend/src/app/api/signin/code/route.ts` calls in process. */
const CODE_SIGN_IN_PATH = "/sign-in/email-otp";

/** The one path that mails a code, which `fl_frontend/src/features/auth/actions.ts :: handleSignIn` calls in process. */
const CODE_SEND_PATH = "/email-otp/send-verification-otp";

const HOUR_MS = 60 * 60 * 1000;

// Prefixes the plugin never writes, so these rows are told from its code rows by identifier alone,
// and an operator can clear every lock at once (`docs/ops/runbooks.md` §17).
const FAILURE_ROW_PREFIX = "sign-in-attempt-";
const MAIL_ROW_PREFIX = "sign-in-mail-";

/** Every address's mails in one count, under the mail rows' prefix so the runbook's sweep of those reaches it. */
const MAIL_TOTAL_IDENTIFIER = `${MAIL_ROW_PREFIX}every-address`;

// The per-address cap lets a flood grow with every member's address, and codes spending the
// provider's quota stop every other mail the league sends. Set well above an hour of real sign-ins.
const CODE_MAIL_TOTAL_LIMIT = 100;

/** The refusal the route words as the address being locked, whatever code the request carried. */
export const ADDRESS_ATTEMPTS_EXHAUSTED = "ADDRESS_ATTEMPTS_EXHAUSTED";

const PASSKEY_REGISTRATION_PATH = "/passkey/verify-registration";

// Both halves of an enrolment, which the plugin gates on `freshAge` and on nothing else -- so the
// hook below is the whole of what a code-borne session meets on either.
const ENROLMENT_PATHS: ReadonlySet<string> = new Set(["/passkey/generate-register-options", PASSKEY_REGISTRATION_PATH]);

// A field the plugin's schemas take and this league's client never sends: it titles the row on the
// surface built to spot a planted one. `createSession` stays open, so setting a passkey up signs in with it.
const ENROLMENT_FIELDS_REFUSED: readonly string[] = ["name"];

// The plugin answers each of these with the session row it minted, `token` -- the cookie's own
// value -- among its fields (`docs/frontend/spec.md :: I198`).
const CEREMONY_VERIFY_PATHS: ReadonlySet<string> = new Set([PASSKEY_REGISTRATION_PATH, PASSKEY_ASSERTION_PATH]);

/** What every finished ceremony answers instead: the plugin's own shape for a call that carries no record back. */
const CEREMONY_DONE = { status: true };

/** What made a session, stamped on its row and read by every guard (`docs/frontend/spec.md :: I260`). */
export const PASSKEY_FACTOR = "passkey";

/** A code mailed to the address: whoever holds the mailbox holds this factor. */
export const CODE_FACTOR = "code";

type AuthFactor = typeof PASSKEY_FACTOR | typeof CODE_FACTOR;

/** The session field naming, by `lineageOf`, the session a sign-in replaced. */
const REPLACED_SESSION_FIELD = "replacedSession";

/** The account field holding when its sessions were last ended: every session made at or before it is no session. */
const SESSIONS_ENDED_FIELD = "sessionsEndedAt";

// Every endpoint that mints a session, with the factor it proves. A path missing here mints nothing,
// so one a release adds fails closed rather than handing out a session no guard has classified
// (`docs/frontend/spec.md :: I398`).
const SESSION_FACTOR_BY_PATH: ReadonlyMap<string, AuthFactor> = new Map([
  [PASSKEY_ASSERTION_PATH, PASSKEY_FACTOR],
  [PASSKEY_REGISTRATION_PATH, PASSKEY_FACTOR],
  [CODE_SIGN_IN_PATH, CODE_FACTOR],
]);

/** Named, because the library's failure line records an error's name and nothing else. */
class SessionFromUnlistedPath extends Error {
  override name = "SessionFromUnlistedPath";
}

// The whole of the user-verification requirement, asked at both ceremonies and checked under them.
// Set to "preferred" and both halves relax together, which is what WebAuthn Level 3 §7.2 conditions
// the check on.

// The plugin asks the enrolment through `authenticatorSelection` and hardcodes "preferred" into the
// assertion's options, so the after hook below writes this into those; the check is ours either way,
// both verifiers being called with `requireUserVerification` off.
const USER_VERIFICATION: "required" | "preferred" = "required";

/** The assertion's options, whose answer the after hook rewrites to carry `USER_VERIFICATION`. */
const PASSKEY_ASSERTION_OPTIONS_PATH = "/passkey/generate-authenticate-options";

/** Both ceremonies, at the point the plugin reaches before it writes a row or mints a session. */
function refuseUnverified(userVerified: boolean): void {
  if (USER_VERIFICATION !== "required" || userVerified) return;

  throw new APIError("BAD_REQUEST", { code: USER_VERIFICATION_REFUSED, message: "The authenticator did not verify the user." });
}

/** As much of a served session as the step-up judges, beside whether its address holds a grant. */
type StepUpCaller = {
  readonly user: { readonly email: string };
  readonly session: { readonly createdAt: Date | string; readonly authFactor?: unknown };
  readonly verwaltung: boolean;
};

/**
 * Whether a session was signed in -- or confirmed, which mints a new one -- recently enough to change
 * passkeys and sign-ins: by either factor for a person, by the passkey for an administrator
 * (`docs/frontend/spec.md :: I261`).
 */
export function isFreshlySignedIn(served: StepUpCaller): boolean {
  if (!isWithinStepUpWindow(served.session.createdAt)) return false;

  return !served.verwaltung || served.session.authFactor === PASSKEY_FACTOR;
}

/**
 * The stamp sits on the stored row and on neither arm's declared type, the library typing both to
 * its own base shape: read through `Reflect` rather than cast, so nothing here claims it is there.
 */
function asStepUpCaller(served: { user: { email: string }; session: object }, verwaltung: boolean): StepUpCaller {
  return {
    user: { email: served.user.email },
    session: {
      createdAt: Reflect.get(served.session, "createdAt") as Date | string,
      authFactor: Reflect.get(served.session, "authFactor"),
    },
    verwaltung: verwaltung,
  };
}

/** Logged where the grant was asked for, as the send gate's own failure is: the error's name alone. */
function logUnreadVerwaltung(failed: unknown): void {
  logger.error("auth.verwaltung_unread", undefined, {
    error_code: "FE-AUTH-010",
    name: failed instanceof Error ? failed.name : "unknown",
  });
}

/**
 * The gate's answer an enrolment is judged by, where an unread read must refuse rather than admit: an
 * enrolment held to the passkey for an administrator would otherwise relax to a person's, by mailed
 * code, while the backend is down.
 */
async function enrolmentAnmeldung(email: string): Promise<AnmeldungRecords> {
  try {
    return await lookUpAnmeldung(asSignInIdentifier(email));
  } catch (failed) {
    logUnreadVerwaltung(failed);
    throw APIError.fromStatus("SERVICE_UNAVAILABLE");
  }
}

/**
 * The grant an enrolment is judged by. A barred address enrols nothing, whatever it holds: its session
 * is one a ban's ending missed or a mint raced, and a passkey would outlive both (`docs/frontend/spec.md :: I406`).
 */
function enrolmentGrant(anmeldung: AnmeldungRecords): boolean {
  if (anmeldung.gesperrt) throw APIError.fromStatus("NOT_FOUND");
  return anmeldung.verwaltung !== null;
}

/**
 * The gate's answer for the caller, read in the registration's before hook and carried on the
 * endpoint's context into its transaction, whose checks then decide without a backend round trip holding it open.
 */
type EnrolmentRead = { readonly userId: string; readonly anmeldung: AnmeldungRecords; readonly sentAt: Date };

/** The context key the carried read travels under; a string, the library merging no symbol key. */
const ENROLMENT_READ = "flEnrolmentRead";

/** The read the before hook carried for `userId`, or `undefined` where it carried none for them. */
function carriedEnrolmentRead(ctx: object | undefined, userId: string): EnrolmentRead | undefined {
  const read: unknown = ctx === undefined ? undefined : Reflect.get(ctx, ENROLMENT_READ);
  if (typeof read !== "object" || read === null) return undefined;

  return Reflect.get(read, "userId") === userId ? (read as EnrolmentRead) : undefined;
}

/** The carried read, or the default-deny net's refusal where the hook carried none for this caller. */
function carriedOrRefuse(ctx: object, userId: string): AnmeldungRecords {
  const read = carriedEnrolmentRead(ctx, userId);
  if (read === undefined) throw APIError.fromStatus("NOT_FOUND");
  return read.anmeldung;
}

/** The records where an unread read offers nothing: `null` where the backend could not say. */
async function subjektOrNull(email: string): Promise<SubjectSession["subjekt"] | null> {
  try {
    return await lookUpSubjekt(asSignInIdentifier(email));
  } catch (failed) {
    logUnreadVerwaltung(failed);
    return null;
  }
}

/** The grant and when it took effect, where an unread one admits nobody: `null` where the backend could not say. */
async function verwaltungOrNull(email: string): Promise<Verwaltung | null> {
  try {
    return await verwaltungOf(email);
  } catch (failed) {
    logUnreadVerwaltung(failed);
    return null;
  }
}

/**
 * Every condition an enrolment meets, on both arms. The plugin gates its two registration endpoints
 * on `freshAge` and on nothing else, which is the wider window every other change takes
 * (`docs/frontend/spec.md :: I261`, `:: I411`).
 */
async function refuseEnrolment(
  adapter: DBTransactionAdapter,
  userId: string,
  caller: StepUpCaller | null,
  credentialID?: string,
): Promise<void> {
  // Every refusal below is the default-deny net's own answer, so an enrolment the page never offers
  // names no surface either.
  if (caller === null) throw APIError.fromStatus("NOT_FOUND");

  const held = await adapter.findMany<{ credentialID?: string }>({
    model: "passkey",
    where: [{ field: "userId", value: userId }],
    limit: PASSKEY_LIMIT + 1,
  });

  // For everybody and before any factor: a passkey outlives the session adding it, so only a sign-in
  // or confirmation of the last minutes may add one.
  if (!isWithinEnrolmentWindow(caller.session.createdAt)) throw APIError.fromStatus("NOT_FOUND");

  // The mailed code enrols an administrator's first passkey and only ever that one: past it a stolen
  // mailbox would put its own authenticator beside the administrator's and never need theirs again.
  const bootstrap = held.length === 0 && caller.verwaltung && caller.session.authFactor === CODE_FACTOR;

  if (!bootstrap && !isFreshlySignedIn(caller)) throw APIError.fromStatus("NOT_FOUND");
  if (held.length >= PASSKEY_LIMIT) throw APIError.fromStatus("NOT_FOUND");

  // The plugin takes the rows already held for an `excludeCredentials` hint, which the BROWSER
  // honours and no server checks: the same authenticator enrolled twice leaves the administrator two
  // rows nothing on the page tells apart (driven against 1.7.7).
  if (credentialID !== undefined && held.some((row) => row.credentialID === credentialID)) throw APIError.fromStatus("NOT_FOUND");
}

// The server's code for a write refused over another transaction's write to the same document; the
// driver exports no name for it.
const WRITE_CONFLICT = 112;

// The server's code for an insert a unique index refused; the driver exports no name for it either.
const DUPLICATE_KEY = 11000;

/** A second row for a credential `fl_frontend/src/core/authIndexes.ts` already holds one of. */
function isDuplicateCredential(failed: unknown): boolean {
  return failed instanceof MongoServerError && failed.code === DUPLICATE_KEY && "credentialID" in (failed.keyPattern ?? {});
}

function isWriteConflict(failed: unknown): boolean {
  // The code, not the `TransientTransactionError` label: the driver labels a lost connection and a
  // stepped-down primary that way too, and neither is another change to these passkeys.
  return failed instanceof MongoServerError && failed.code === WRITE_CONFLICT;
}

/** Named, because the library's failure line records an error's name and nothing else. */
class ClaimMatchedNoAccount extends Error {
  override name = "ClaimMatchedNoAccount";
}

/** Named for the same reason as `ClaimMatchedNoAccount`. */
class RemovalOutsideTransaction extends Error {
  override name = "RemovalOutsideTransaction";
}

/**
 * The write every removal of one administrator's passkeys makes, inside the transaction holding its
 * count and its delete: the database refuses the second of two, where the count alone admits both
 * (`docs/frontend/spec.md :: I341`).
 */
async function claimAccount(adapter: Pick<DBTransactionAdapter, "update">, userId: string): Promise<void> {
  // Any field of the account's own row conflicts; `updatedAt` is one the row already carries, so the
  // claim stores nothing new about the administrator.
  const claimed = await adapter.update({ model: "user", where: [{ field: "id", value: userId }], update: { updatedAt: new Date() } });

  // A claim on no row conflicts with nothing, which is the removal the transaction exists to refuse.
  if (claimed === null) throw new ClaimMatchedNoAccount();
}

/** Named for the same reason as `ClaimMatchedNoAccount`. */
class CeremonyNamedNoCredential extends Error {
  override name = "CeremonyNamedNoCredential";
}

/**
 * The credential a finished passkey ceremony proved. The assertion looked its row up by this id and
 * verified the signature against that row's key; the registration's is held to the attested id in
 * `registration.afterVerification`, the verifier comparing the two nowhere.
 */
function ceremonyCredentialId(ctx: Pick<GenericEndpointContext, "body">): string {
  const declared = declaredCredentialId(ctx);
  if (typeof declared !== "string" || declared === "") throw new CeremonyNamedNoCredential();

  return declared;
}

/** The plugin's own name for its challenge cookie, which its options leave at the default here. */
const PASSKEY_CHALLENGE_COOKIE = "better-auth-passkey";

/**
 * A signed-in page's challenge names its account, and the plugin checks the credential, never whose:
 * another account's passkey would sign that account in and end the page's session (`docs/frontend/spec.md :: I428`).
 */
async function refuseAnotherAccountsPasskey(ctx: GenericEndpointContext): Promise<void> {
  const token = await ctx.getSignedCookie(ctx.context.createAuthCookie(PASSKEY_CHALLENGE_COOKIE).name, ctx.context.secret);
  // Left to the plugin, which refuses a missing or spent challenge itself.
  if (typeof token !== "string" || token === "") return;

  const challenge = await ctx.context.internalAdapter.findVerificationValue(token);
  if (challenge === null) return;

  const parsed: unknown = JSON.parse(challenge.value);
  const userData: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "userData") : undefined;
  const expected: unknown = typeof userData === "object" && userData !== null ? Reflect.get(userData, "id") : undefined;
  if (typeof expected !== "string" || expected === "") return;

  const credentialID = declaredCredentialId(ctx);
  if (typeof credentialID !== "string" || credentialID === "") return;

  const answered = await ctx.context.adapter.findOne<{ userId: string }>({
    model: "passkey",
    where: [{ field: "credentialID", value: credentialID }],
  });
  if (answered !== null && answered.userId !== expected) throw APIError.fromStatus("UNAUTHORIZED");
}

/** The session cookie a sign-in's request carried, which names the session it replaces, or `null`. */
async function replacedToken(ctx: GenericEndpointContext): Promise<string | null> {
  // The cookie rather than `getSessionFromCtx`, whose read refreshes the replaced row and writes a
  // `Set-Cookie` for it into the very response that carries the new one.
  const replaced = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
  return typeof replaced === "string" && replaced !== "" ? replaced : null;
}

/**
 * What every session minted to replace one cookie is stamped with. Keyed and prefixed, so the row holds
 * neither the replaced token nor the signature half of its cookie, which is the same key over the bare token.
 */
function lineageOf(replaced: string, secret: string): Promise<string> {
  return makeSignature(`replaced-session:${replaced}`, secret);
}

/**
 * Whether `row` was inserted before `minted`: by `updatedAt`, stamped at the insert where `createdAt` dates
 * the gate read, a tie in the millisecond going by id, as the Mongo adapter's `ObjectId`s rise with each
 * insert this process makes.
 */
function mintedBefore(row: { id: string; updatedAt: Date | string }, minted: { id: string; updatedAt: Date | string }): boolean {
  const rowAt = new Date(row.updatedAt).getTime();
  const mintedAt = new Date(minted.updatedAt).getTime();
  return rowAt < mintedAt || (rowAt === mintedAt && row.id < minted.id);
}

/**
 * Ends the sessions minted earlier to replace the same cookie: two step-ups from one browser at once
 * each mint one, and only one `Set-Cookie` survives in the browser (`docs/frontend/spec.md :: I485`).
 */
async function endEarlierSiblings(
  context: Pick<AuthContext, "adapter">,
  minted: { id: string; userId: string; updatedAt: Date | string },
  lineage: string,
): Promise<void> {
  const siblings = await context.adapter.findMany<{ id: string; updatedAt: Date | string }>({
    model: "session",
    where: [
      { field: "userId", value: minted.userId },
      { field: REPLACED_SESSION_FIELD, value: lineage },
    ],
    limit: EVERY_ROW,
  });

  // Every hook keeps the latest it sees and ends the rest, its own row included: the last hook to run
  // sees every sibling whatever order the inserts landed in, so exactly one stands.
  const rows = siblings.some((row) => row.id === minted.id) ? siblings : [...siblings, minted];
  const latest = rows.reduce((kept, row) => (mintedBefore(kept, row) ? row : kept));
  // Its own row ends only where a later mint was inserted first, and the browser may keep this
  // response's cookie all the same: that fails closed, as a sign-in asked again.
  const earlier = rows.filter((row) => row.id !== latest.id).map((row) => row.id);
  if (earlier.length === 0) return;

  await context.adapter.deleteMany({ model: "session", where: [{ field: "id", operator: "in", value: earlier }] });
}

/**
 * Ends the session the request's cookie named once a sign-in has minted its successor: a step-up
 * would otherwise leave the session it replaced alive beside the new one (`docs/frontend/spec.md :: I399`).
 */
async function endReplacedSession(
  ctx: GenericEndpointContext,
  minted: { id: string; token: string; userId: string; updatedAt: Date | string },
): Promise<void> {
  const replaced = await replacedToken(ctx);
  if (replaced === null || replaced === minted.token) return;

  try {
    await ctx.context.internalAdapter.deleteSession(replaced);
    await endEarlierSiblings(ctx.context, minted, await lineageOf(replaced, ctx.context.secret));
  } catch (failed) {
    // Logged and left: the new session is committed, and failing the sign-in now would strand it
    // without its cookie while the replaced one stayed alive anyway.
    logger.error("auth.session_rotation_failed", undefined, {
      error_code: "FE-AUTH-006",
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/**
 * The send gate's verdict, asked again of the account a session is about to be minted for: a code
 * mailed before a ban, and every passkey, would otherwise sign in past it. Only `admitted` mints.
 */
async function refuseUnadmitted(ctx: GenericEndpointContext, userId: string): Promise<Date> {
  const account = await ctx.context.internalAdapter.findUserById(userId);
  // Inside a registration's transaction the before hook's read decides, never a second round trip.
  const carried = carriedEnrolmentRead(ctx, userId);
  // Answered to date the session it admits: taken before the read is sent, so a ban the read missed ends it.
  const sentAt = carried?.sentAt ?? new Date();
  const verdict =
    account === null ? "failed" : carried === undefined ? await mayReceiveSignIn(account.email) : signInVerdictOf(carried.anmeldung);
  if (verdict === "admitted") return sentAt;

  // Worded where the ceremony starts (`fl_frontend/src/features/auth/passkeyAnswers.ts`); a failed
  // read is the backend's and not the person's, so it answers as a retry would.
  if (verdict === "barred") throw new APIError("FORBIDDEN", { code: SIGN_IN_BARRED, message: "The address is barred." });
  if (verdict === "holds-nothing") throw new APIError("FORBIDDEN", { code: SIGN_IN_HOLDS_NOTHING, message: "The address holds nothing." });
  throw APIError.fromStatus("SERVICE_UNAVAILABLE");
}

/** As much of the library's context as the bounds below read and write. */
type BoundContext = Pick<AuthContext, "adapter" | "internalAdapter" | "secret">;

/**
 * Keyed under the library's own secret, never hashed plain: an address is guessable, so an unkeyed
 * digest is the address (`docs/frontend/spec.md :: I445`). Folded, so two spellings share one bound.
 */
async function boundIdentifier(prefix: string, email: string, secret: string): Promise<string> {
  return `${prefix}${await makeSignature(asSignInIdentifier(email), secret)}`;
}

/**
 * The row goes in BEFORE the count, so racing requests each count the other's; a refused event takes
 * its own back out, so hammering a closed bound never holds it past its window. Answers the admitted
 * row, or `null`.
 */
async function withinBound(context: BoundContext, identifier: string, limit: number, windowMs: number): Promise<string | null> {
  const own = await context.internalAdapter.createVerificationValue({
    identifier,
    value: "counted",
    expiresAt: new Date(Date.now() + windowMs),
  });

  const held = await context.adapter.count({
    model: "verification",
    where: [
      { field: "identifier", value: identifier },
      // Filtered here as well as swept by the library and by the TTL index: either can lag.
      { field: "expiresAt", operator: "gt", value: new Date() },
    ],
  });
  if (held <= limit) return own.id;

  await context.adapter.delete({ model: "verification", where: [{ field: "id", value: own.id }] });
  return null;
}

/**
 * Whether every address together has already been mailed the hour's total: a read alone, writing nothing,
 * so two sends racing for the hour's last mail both pass it (`docs/frontend/spec.md` §4).
 */
async function mailTotalReached(context: BoundContext): Promise<boolean> {
  const mailed = await context.adapter.count({
    model: "verification",
    where: [
      { field: "identifier", value: MAIL_TOTAL_IDENTIFIER },
      { field: "expiresAt", operator: "gt", value: new Date() },
    ],
  });
  return mailed >= CODE_MAIL_TOTAL_LIMIT;
}

/**
 * Each code sign-in's own failure row, from the hook counting it to the hook settling it, keyed on the
 * body both are handed: the newest row may be a racing attempt's, whose own removal would find nothing.
 */
const attemptRows = new WeakMap<object, string>();

/**
 * `refuseUnadmitted`'s answers, which a code sign-in meets only once its code has verified: none of
 * them is a guess, and counted as one a ban or a backend outage would spend the address's day.
 */
function refusedAtMint(returned: APIError): boolean {
  const code: unknown = returned.body?.code;
  return code === SIGN_IN_BARRED || code === SIGN_IN_HOLDS_NOTHING || returned.status === "SERVICE_UNAVAILABLE";
}

/**
 * What a refused code sign-in leaves counted against its address: a code the plugin refused, and
 * nothing the mint refused past it. A sign-in clears the count wherever a session is minted.
 */
async function settleCodeAttempt(context: BoundContext, own: string | undefined, returned: unknown): Promise<void> {
  if (own === undefined || !isAPIError(returned) || !refusedAtMint(returned)) return;

  await context.adapter.delete({ model: "verification", where: [{ field: "id", value: own }] });
}

/**
 * Ten failures in a row lock an address's code, and a sign-in by any factor ends the row
 * (`docs/frontend/spec.md :: I441`): a passkey is the way the lock's own sentence points to.
 */
async function clearCodeFailures(context: BoundContext, userId: string): Promise<void> {
  const account = await context.internalAdapter.findUserById(userId);
  if (account === null) return;

  // `deleteMany` and never `deleteVerificationByIdentifier`, which the MongoDB adapter carries out as
  // `deleteOne`: a sign-in after three failures would clear one of them.
  const identifier = await boundIdentifier(FAILURE_ROW_PREFIX, account.email, context.secret);
  await context.adapter.deleteMany({ model: "verification", where: [{ field: "identifier", value: identifier }] });
}

/**
 * Takes back the failure a code sign-in's `body` was counted as, for the route's second tab: a spent
 * code met by the sign-in it already made is no guess.
 */
export async function forgiveCodeAttempt(body: object): Promise<void> {
  const own = attemptRows.get(body);
  if (own === undefined) return;

  const { adapter } = await auth.$context;
  await unlessUnsettled(() => adapter.delete({ model: "verification", where: [{ field: "id", value: own }] }).then(() => undefined));
}

/** A count left standing expires on its own, so a bookkeeping failure never fails the sign-in it follows. */
async function unlessUnsettled(settle: () => Promise<void>): Promise<void> {
  try {
    await settle();
  } catch (failed) {
    logger.warn("auth.code_attempt_unsettled", {
      error_code: "FE-AUTH-009",
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/** The address a sign-in code is asked for, or `null` for a send of any other type. */
function codeSendAddress(body: unknown): string | null {
  const type: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "type") : undefined;
  return type === "sign-in" ? codeSignInAddress(body) : null;
}

/** The address a code sign-in names, or `null` where the body carries none the library would read. */
function codeSignInAddress(body: unknown): string | null {
  const email: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "email") : undefined;
  return typeof email === "string" ? email : null;
}

/* The library mounts far more endpoints than a browser here calls, and an upgrade adds more, so the
   surface is closed from two sides: the documented switch below, and the default-deny hook that also
   covers what it cannot. */

// What a browser of this league calls: `fl_frontend/src/core/authClient.ts`'s two ceremonies, four
// paths. The sign-in, the sign-out and every guard run in process instead.

// Three spellings come from the constants the stamp, the enrolment refusal and the assertion's ask
// compare, so a release that renamed one would 404 the real ceremony rather than let it through unjudged.
const BROWSER_PATHS: ReadonlySet<string> = new Set([...ENROLMENT_PATHS, PASSKEY_ASSERTION_OPTIONS_PATH, PASSKEY_ASSERTION_PATH]);

// The library's own switch, which refuses before a route is matched or a body read.

// It compares a path derived from the URL, so neither parameterised route can be named here at all
// and the hook is what refuses those two.
const DISABLED_PATHS: readonly string[] = [
  "/account-info",
  "/change-email",
  "/change-password",
  "/delete-user",
  "/delete-user/callback",
  "/email-otp/change-email",
  "/email-otp/check-verification-otp",
  "/email-otp/request-email-change",
  "/email-otp/request-password-reset",
  "/email-otp/reset-password",
  CODE_SEND_PATH,
  "/email-otp/verify-email",
  "/error",
  "/forget-password/email-otp",
  "/get-access-token",
  "/get-session",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/ok",
  "/passkey/delete-passkey",
  "/passkey/list-user-passkeys",
  "/passkey/update-passkey",
  "/refresh-token",
  "/request-password-reset",
  "/reset-password",
  "/revoke-other-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/send-verification-email",
  "/sign-in/email",
  CODE_SIGN_IN_PATH,
  "/sign-in/social",
  "/sign-out",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

/**
 * A failed send leaves the change standing: a passkey row rolled back for an unreachable mailbox is
 * a lockout the reader never asked for (`docs/frontend/spec.md :: I314`).
 */
async function notify(message: PasskeyEmail, email: string): Promise<void> {
  try {
    await sendMail({ to: email, ...message });
  } catch (failed) {
    // Filed by a deployment that mails nothing, or kept from a barred address, each recorded by the
    // mailer's own line (`docs/frontend/spec.md :: I542`).
    const ausfall = versandAusfallOf(failed);
    if (ausfall === "zurueckgehalten" || ausfall === "gesperrt") return;

    // Name only, as the code's own send writes one: a failure here routinely carries the address.
    logger.error("auth.passkey_notice_failed", undefined, {
      error_code: "FE-AUTH-004",
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/**
 * Exported for `fl_frontend/src/features/passkeys/actions.ts`, the one place a removal happens. Composed
 * on the serving origin, never `brand.ts :: SITE_URL` (I186).
 */
export async function notifyPasskeyRemoved(email: string): Promise<void> {
  await notify(buildPasskeyGeloeschtEmail({ zeitpunkt: new Date(), origin: frontend_config.AUTH_URL, konto: KONTO_HREF }), email);
}

// Matched on the OPENING of the library's own message, because each of these ends in the value it
// rejected.

// The events are this repository's, so an upgrade that rewords one falls to the entry below
// rather than putting the reworded message on the stream.
const LIBRARY_EVENTS: readonly (readonly [string, string])[] = [
  ["Invalid origin", "auth.origin_refused"],
  ["Invalid callbackURL", "auth.callback_refused"],
  ["Invalid redirectURL", "auth.callback_refused"],
  ["Invalid errorCallbackURL", "auth.callback_refused"],
  ["Invalid newUserCallbackURL", "auth.callback_refused"],
  ["Blocked cross-site navigation login attempt", "auth.cross_site_login_blocked"],
  // The adapter's own line, `fl_frontend/patches/@better-auth__mongo-adapter@1.7.7.patch` (`docs/frontend/spec.md :: I537`).
  ["Transaction left open", "auth.transaction_left_open"],
];

const LIBRARY_EVENT_UNKNOWN = "auth.library_failed";

/** The passkey plugin's line for a registration that failed past its verifier, which its error names. */
const REGISTRATION_FAILED = "Failed to verify registration";

const sessionOptions = {
  expiresIn: SESSION_EXPIRES_IN_SECONDS,
  updateAge: SESSION_UPDATE_AGE_SECONDS,
  // The library gates passkey REGISTRATION on this figure, measured from `createdAt`: the same window
  // `isFreshlySignedIn` judges every other step-up by, so the page never offers what either refuses.
  freshAge: STEP_UP_WINDOW_MS / 1000,
  // Off, so revocation stays a store read on every request and the guards below judge a stored
  // row rather than a signed copy of one.
  cookieCache: { enabled: false },
  additionalFields: {
    // `input: false` is the whole defence for both: left writable, any holder of any session stamps
    // itself as passkey-verified, or names another passkey's sessions, through `POST /update-session`.
    authFactor: { type: "string", required: false, input: false },
    // The `credentialID` of the passkey that made the session, so removing that passkey ends its
    // sessions and no other (`docs/frontend/spec.md :: I400`).
    passkeyCredentialId: { type: "string", required: false, input: false },
    // Never returned: no guard reads it, and nothing but another sign-in's stamp is compared with it.
    [REPLACED_SESSION_FIELD]: { type: "string", required: false, input: false, returned: false },
  },
} satisfies BetterAuthOptions["session"];

const userOptions = {
  additionalFields: {
    // Returned, so the session read already holds the instant every guard compares a session with;
    // `input: false`, so no session writes it for itself.
    [SESSIONS_ENDED_FIELD]: { type: "date", required: false, input: false },
  },
} satisfies BetterAuthOptions["user"];

// Called by `build`, never at import: `next build` imports this module in every page-data worker
// holding no environment, where neither the URL nor the client can be built
// (`docs/frontend/spec.md :: I45`). `origin` gives both halves of the WebAuthn binding.
const authOptions = (origin: URL, client: MongoClient) =>
  ({
    // The `Db` off the one client this process opens, never a second connection
    // (`docs/frontend/spec.md :: I120`).
    database: mongodbAdapter(client.db(MONGO_DB_NAME), { client }),

    // Passed rather than left to the environment: the library reads no bare `AUTH_URL`, and this
    // value's origin also decides the `__Host-` cookie prefix below and the passkey relying-party id.
    baseURL: frontend_config.AUTH_URL,
    secret: authSecret(),

    session: sessionOptions,
    user: userOptions,

    // Left to its default, the library would store the caller's address on every session row; the switch
    // below stores none, and nothing here would read one, the limiter that would being off (`docs/ops/spec.md :: I4`).

    advanced: {
      // The session and its user in one `$lookup` rather than a second query: every guard reads the
      // session on every request, cookie caching being off above.
      database: { joins: true },
      // The edge's own access line already carries the address, under a bound (`docs/datenschutz.md` §6).
      ipAddress: { disableIpTracking: true },
      // Host-bound over https (`docs/frontend/spec.md :: I401`). Through the prefix and never a cookie
      // name: the library puts `__Secure-` ahead of any name while `useSecureCookies` is on, and a
      // `__Secure-__Host-` cookie is bound to no host.
      ...(origin.protocol === "https:" ? { useSecureCookies: false, cookiePrefix: `__Host-${MONGO_DB_NAME}` } : {}),
    },

    // Never "hashed": the hook below matches a code row by its plain prefix, and each bound writes through
    // the library but counts through the raw adapter, so hashing would stamp no code and count nothing.
    verification: { storeIdentifier: "plain" },

    databaseHooks: {
      verification: {
        create: {
          // A wrong guess writes its code back stamped now, and the plugin takes the newest stamp for the
          // live code, so a send racing the guess would lose to it: stamped with its issue time instead
          // (`docs/frontend/spec.md :: I486`).
          before: async (row, ctx) => {
            if (!row.identifier.startsWith(CODE_ROW_PREFIX)) return;
            const issued = new Date(row.expiresAt).getTime() - CODE_VALIDITY_SECONDS * 1000;
            // The write-back keeps the stamp its code was issued under, the expiry carrying it.
            const stamp = ctx?.path === CODE_SIGN_IN_PATH ? issued : nextCodeStamp(issued);
            return { data: { ...row, createdAt: new Date(stamp), expiresAt: new Date(stamp + CODE_VALIDITY_SECONDS * 1000) } };
          },
        },
      },
      session: {
        create: {
          // Every sign-in writes an identical row, so the endpoint path is the only thing separating
          // them. This stamps; the guards below decide.
          before: async (session, ctx) => {
            // Absent on a mint no endpoint made, which is no sign-in this league offers. Tested for
            // falsiness: the library hands `undefined` there, whatever its type says.
            const factor = ctx ? SESSION_FACTOR_BY_PATH.get(ctx.path) : undefined;
            if (!ctx || factor === undefined) throw new SessionFromUnlistedPath();

            // Here, where every sign-in passes -- a code, a passkey, a set-up that signs in, a step-up --
            // and never at one method's own callback, which the next method would walk past
            // (`docs/frontend/spec.md :: I403`).
            const admittedAsOf = await refuseUnadmitted(ctx, session.userId);

            const credential = factor === PASSKEY_FACTOR ? { passkeyCredentialId: ceremonyCredentialId(ctx) } : {};
            const replaced = await replacedToken(ctx);
            const lineage = replaced === null ? {} : { [REPLACED_SESSION_FIELD]: await lineageOf(replaced, ctx.context.secret) };

            // Stamped again past every await, so the order of two mints is their order of insert, one write
            // apart, and not of a backend round trip: `endEarlierSiblings` keeps the latest by it.
            const stamped = new Date();
            const lifetime = new Date(session.expiresAt).getTime() - new Date(session.createdAt).getTime();

            return {
              data: {
                ...session,
                // As of the gate read, never its insert: a ban committing between the two ends the
                // account's sessions before this row exists, and dated past it the row outlives the lift
                // (`docs/frontend/spec.md :: I528`).
                createdAt: admittedAsOf,
                updatedAt: stamped,
                expiresAt: new Date(stamped.getTime() + lifetime),
                // Emptied here because the library offers no switch for it, beside the one above that
                // empties the address: a second copy of the caller under no retention clock.
                userAgent: "",
                authFactor: factor,
                ...credential,
                ...lineage,
              },
            };
          },
          // Right after the insert, past every refusal; after the commit only for a set-up that signs in.
          // On the assertion and code paths a failed user read or cookie write still signs the caller out.
          after: async (session, ctx) => {
            if (!ctx) return;
            await endReplacedSession(ctx, session);
            await unlessUnsettled(() => clearCodeFailures(ctx.context, session.userId));
          },
        },
      },
    },

    // Off everywhere: the edge meters these paths (`docs/ops/spec.md :: I4`), and the library's own
    // rules key on a network address it does not store and reach no in-process call; `withinBound`
    // stands in for them.
    rateLimit: { enabled: false },

    disabledPaths: [...DISABLED_PATHS],

    // Shaped rather than left to the library's default, which prints whole error objects and a
    // rejected `callbackURL` or `origin` VALUE, both of them submitted (`docs/logging/spec.md :: L9`).
    logger: {
      // Below this the library has only static boot notes, and a line this handler may not quote is
      // a line with nothing in it.
      level: "error",
      log: (_level, message, ...args: unknown[]) => {
        // Matched to an event of this repository's own and never forwarded, because the library
        // interpolates the rejected value into the message itself.
        const event = LIBRARY_EVENTS.find(([opening]) => message.startsWith(opening))?.[1] ?? LIBRARY_EVENT_UNKNOWN;

        // `args` is dropped whole: it carries the error object itself, which
        // `fl_frontend/src/core/logFormat.ts :: serializeError` writes with its message and stack.
        const raised = args.find((argument) => argument instanceof Error);

        // One authenticator enrolled twice at once: the credential index refuses the second row, inside a set-up's
        // transaction as a write conflict. Any conflict there maps here, so a write added to that transaction joins it.
        if (message.startsWith(REGISTRATION_FAILED) && (isDuplicateCredential(raised) || isWriteConflict(raised))) {
          logger.warn("auth.passkey_enrolment_conflict", { error_code: "FE-AUTH-005" });
          return;
        }

        logger.error(event, undefined, { error_code: "FE-AUTH-003", name: raised?.name ?? "unknown" });
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Above the in-process return below, because the route handler's own call is in process and
        // is the only caller. Counted whatever the address holds: a lock only members met would be a
        // membership oracle.
        const address = ctx.path === CODE_SIGN_IN_PATH ? codeSignInAddress(ctx.body) : null;
        if (address !== null) {
          const own = await withinBound(
            ctx.context,
            await boundIdentifier(FAILURE_ROW_PREFIX, address, ctx.context.secret),
            CODE_FAILURE_LIMIT,
            CODE_FAILURE_WINDOW_HOURS * HOUR_MS,
          );
          if (own === null) {
            logger.info("auth.code_attempts_exhausted");
            throw new APIError("TOO_MANY_REQUESTS", { code: ADDRESS_ATTEMPTS_EXHAUSTED, message: "Too many failed codes for this address." });
          }
          if (typeof ctx.body === "object" && ctx.body !== null) attemptRows.set(ctx.body, own);
        }

        // Ahead of the plugin, which writes each new code before its send callback runs: capped there,
        // a send voids the held code and mails none. Ahead of the gate, so the store's rows never tell a
        // member from a stranger.
        const recipient = ctx.path === CODE_SEND_PATH ? codeSendAddress(ctx.body) : null;

        // The total read ahead of the plugin as well, so a full hour voids no held code; writing nothing
        // and naming nobody, it answers members and strangers alike. The counted row comes past the gate.
        if (recipient !== null && (await mailTotalReached(ctx.context))) {
          logger.warn("auth.code_mail_total_capped", { error_code: "FE-AUTH-008" });
          return ctx.json({ success: true });
        }

        if (
          recipient !== null &&
          (await withinBound(
            ctx.context,
            await boundIdentifier(MAIL_ROW_PREFIX, recipient, ctx.context.secret),
            CODE_MAIL_LIMIT,
            CODE_MAIL_WINDOW_HOURS * HOUR_MS,
          )) === null
        ) {
          logger.info("auth.code_mail_capped");
          // The plugin's own answer to a send, so a capped one reads as a mailed one.
          return ctx.json({ success: true });
        }

        // Both arms: an in-process assertion answered by another account's passkey is no less that account's.
        if (ctx.path === PASSKEY_ASSERTION_PATH) await refuseAnotherAccountsPasskey(ctx);

        // Above the in-process return, so both arms carry it: the registration's transaction opens later,
        // and a backend round trip inside it would hold it open (`docs/frontend/spec.md :: I482`).
        const enrolling = ctx.path === PASSKEY_REGISTRATION_PATH ? await getSessionFromCtx(ctx) : null;
        // Taken before the read is sent: the session a set-up mints is dated by it.
        const sentAt = new Date();
        const enrolmentRead: EnrolmentRead | undefined =
          enrolling === null
            ? undefined
            : { userId: enrolling.user.id, anmeldung: await enrolmentAnmeldung(enrolling.user.email), sentAt: sentAt };
        const carried = enrolmentRead === undefined ? undefined : { context: { [ENROLMENT_READ]: enrolmentRead } };

        // An absent `ctx.request` is the library's own test for a call that did not arrive over HTTP,
        // taken by `originCheckMiddleware` and by `requestOnlySessionMiddleware`. Nothing in process
        // is filtered here: those callers are this repository's own code.
        if (ctx.request === undefined) return carried;

        // The switch above is a denylist, so an endpoint the next upgrade mounts arrives open; this
        // is the default-deny net behind it, over `ctx.path`, the endpoint's own declared route
        // rather than a string derived from the URL a caller sent.
        if (!BROWSER_PATHS.has(ctx.path)) throw APIError.fromStatus("NOT_FOUND");

        if (!ENROLMENT_PATHS.has(ctx.path)) return carried;

        // Refused rather than dropped: a caller who read the plugin's own body schema is answered,
        // and a request reshaped behind its back is how the next reader believes the field works.
        const asked: unknown = ctx.body;
        for (const field of ENROLMENT_FIELDS_REFUSED) {
          if (typeof asked === "object" && asked !== null && field in asked) throw APIError.fromStatus("BAD_REQUEST");
          // The options half takes `name` on the query string instead, where it becomes the account
          // name the browser's own prompt shows.
          if (Reflect.get(ctx.query ?? {}, field) !== undefined) throw APIError.fromStatus("BAD_REQUEST");
        }

        // The plugin gates both halves on `freshAge` alone, which a code-borne session is inside.
        const caller = enrolling ?? (await getSessionFromCtx(ctx));

        // Refused rather than left to the plugin's `freshSessionMiddleware`, which is mounted only
        // while `registration.requireSession` keeps its default: this arm judges nothing about a
        // session it cannot read, and the in-process arm already refuses one.
        if (caller === null || endedByItsAccount(caller)) throw APIError.fromStatus("NOT_FOUND");

        await refuseEnrolment(
          ctx.context.adapter,
          caller.user.id,
          asStepUpCaller(caller, enrolmentGrant(enrolmentRead?.anmeldung ?? (await enrolmentAnmeldung(caller.user.email)))),
        );

        return carried;
      }),

      // The `Set-Cookie` the endpoint wrote is untouched: `runAfterHooks` merges this hook's own
      // headers into the response's rather than replacing them, so the credential still travels.
      after: createAuthMiddleware(async (ctx) => {
        // Logged and left on a failure: by now the rotation has ended the browser's old session, so a
        // throw here would answer a right code with a 500 and no cookie.
        if (ctx.path === CODE_SIGN_IN_PATH && typeof ctx.body === "object" && ctx.body !== null) {
          const own = attemptRows.get(ctx.body);
          await unlessUnsettled(() => settleCodeAttempt(ctx.context, own, ctx.context.returned));
        }

        const offered: unknown = ctx.context.returned;
        if (ctx.path === PASSKEY_ASSERTION_OPTIONS_PATH && !isAPIError(offered) && typeof offered === "object" && offered !== null) {
          return ctx.json({ ...offered, userVerification: USER_VERIFICATION });
        }

        if (!CEREMONY_VERIFY_PATHS.has(ctx.path)) return undefined;

        // Left standing where the ceremony was refused, or a refusal is answered as a success.
        if (isAPIError(ctx.context.returned)) return undefined;

        // Here rather than in the callback above, which runs BEFORE the write: a notice sent there
        // would name an enrolment a later refusal never made.
        if (ctx.path === PASSKEY_REGISTRATION_PATH) {
          const enrolled = await getSessionFromCtx(ctx);
          if (enrolled !== null) {
            await notify(
              buildPasskeyHinzugefuegtEmail({ zeitpunkt: new Date(), origin: frontend_config.AUTH_URL, konto: KONTO_HREF }),
              enrolled.user.email,
            );
          }
        }

        // The browser client reads nothing off either body but whether it is there
        // (`@better-auth/passkey/client :: getPasskeyActions`).
        return ctx.json(CEREMONY_DONE);
      }),
    },

    plugins: [
      // `disableSignUp` stays off: every person's row is written at their first verification, so set
      // it the first correct code dies, and the gate below is the only barrier.

      // A code row for EVERY address typed, and the send below handed each one, so a verify reads alike
      // for a member and a stranger and the gate decides only the mail (`docs/frontend/spec.md :: I443`).
      emailOTP({
        otpLength: SIGN_IN_CODE_LENGTH,
        expiresIn: CODE_VALIDITY_SECONDS,
        allowedAttempts: 3,
        // Encrypted under the secret rather than hashed: an unkeyed hash of six digits is undone by
        // trying all million of them.
        storeOTP: "encrypted",
        // Every send mints a new code, valid ten minutes from its own mail, and voids the one before.
        // "reuse" moved a live code's expiry on every send, so a code asked for again every few minutes
        // never lapsed.
        resendStrategy: "rotate",
        async sendVerificationOTP({ email, otp, type }, ctx) {
          // The one type this application asks for: every endpoint minting another is refused over
          // HTTP and never called in process.
          if (type !== "sign-in") return;

          // The refusal, whole: an address the gate refuses, for whatever reason, is mailed nothing
          // and this returns as though it had, so every branch is one answer.
          if ((await mayReceiveSignIn(email)) !== "admitted") return;

          // Mails sent, past the gate: a count of requests would let invented addresses close sign-in
          // for everyone. Its rows carry no address and no hash of one, so the aggregate tells nobody who
          // is a member.
          if (
            ctx === undefined ||
            (await withinBound(ctx.context, MAIL_TOTAL_IDENTIFIER, CODE_MAIL_TOTAL_LIMIT, CODE_MAIL_WINDOW_HOURS * HOUR_MS)) === null
          ) {
            logger.warn("auth.code_mail_total_capped", { error_code: "FE-AUTH-008" });
            return;
          }

          // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is
          // not production must not mail production links (`docs/frontend/spec.md :: I186`).
          const message = buildCodeEmail(otp, frontend_config.AUTH_URL);

          try {
            // Tagged so the delivery webhook can tell this lane from the application flow's and put
            // a bounce on the stream: a mailbox refusing the code locks out whoever holds no passkey,
            // and an untagged event reaches no reader at all.
            await sendMail({ to: email, ...message, tags: { [ANMELDUNG_TAG]: ANMELDUNG_CODE } });
          } catch (failed) {
            // Filed by a deployment that mails nothing, or kept from an address barred since the gate
            // above read it, each recorded by the mailer's own line (`docs/frontend/spec.md :: I542`).
            const ausfall = versandAusfallOf(failed);
            if (ausfall === "zurueckgehalten" || ausfall === "gesperrt") return;

            // Name only: a failure on this path routinely carries the submitted address, and
            // `fl_frontend/src/core/logFormat.ts :: serializeError` writes a message and stack in full.
            logger.error("auth.code_send_failed", undefined, {
              error_code: "FE-AUTH-002",
              name: failed instanceof Error ? failed.name : "unknown",
            });
          }
        },
      }),

      // `rpName` is what the browser's own passkey prompt shows, and the plugin's default names the
      // library rather than this league.

      // `authenticatorSelection` carries the ask into the enrolment's options, the after hook into the
      // assertion's; the library verifies the flag on neither response, so `afterVerification` below is
      // the whole of the check.
      passkey({
        rpName: BRAND_NAME,
        // Named rather than left to the plugin's own derivation, which answers this same host off
        // `baseURL`: what an enrolled passkey is bound to for life outlives that option.
        rpID: origin.hostname,
        // Unset, this is the caller's own `Origin` header -- a ceremony checked against the value its
        // own sender chose.
        origin: origin.origin,
        authenticatorSelection: { userVerification: USER_VERIFICATION, residentKey: "required" },
        // Both callbacks run before the plugin writes anything -- ahead of the passkey row, and ahead
        // of the counter and the session -- so a refusal here leaves the store as it found it.
        registration: {
          afterVerification: async ({ ctx, verification, user }) => {
            refuseUnverified(verification.registrationInfo?.userVerified === true);

            // The verifier holds the posted `id` to `rawId` and neither to the attested credential, so
            // a session this enrolment mints would otherwise name whichever passkey its caller chose.
            if (declaredCredentialId(ctx) !== verification.registrationInfo?.credential.id) throw APIError.fromStatus("BAD_REQUEST");

            // The transaction the plugin opens around a set-up that signs in, where one is open, so the
            // count below reads the snapshot the row is written in. Two enrolments at once may both
            // stand (`docs/frontend/spec.md` §4).
            const adapter = await getCurrentAdapter(ctx.context.adapter);

            // Judged again here, the last point before the row is written, and reached by an `auth.api`
            // call the hook lets through; off the hook's carried read, and nothing where it carried none.

            // `ctx.context.session` is put there by the plugin's own `freshSessionMiddleware`, which it
            // mounts only while `registration.requireSession` keeps its default: unset it and this arm
            // sees no factor at all and refuses every enrolment.
            const enrolling = ctx.context.session ?? null;
            await refuseEnrolment(
              adapter,
              user.id,
              enrolling === null ? null : asStepUpCaller(enrolling, enrolmentGrant(carriedOrRefuse(ctx, enrolling.user.id))),
              verification.registrationInfo?.credential.id,
            );
          },
        },
        authentication: { afterVerification: ({ verification }) => refuseUnverified(verification.authenticationInfo.userVerified) },
      }),

      passkeyLastUse(),

      // No `customSession` while its read answers a store that does not answer as no session: until a
      // release lets that failure throw, `projected` below builds the guards' copy over the library's
      // own read (`docs/frontend/spec.md :: I519`).

      // Last, which the library warns about: it copies a response's `set-cookie` into Next's store.
      nextCookies(),
    ],
  }) satisfies BetterAuthOptions;

const build = () => betterAuth(authOptions(new URL(frontend_config.AUTH_URL), signInStore()));
let built: ReturnType<typeof build> | undefined;

// Built on first use rather than at import: `next build` loads this module in every page-data worker with the secret
// undefined (`docs/frontend/spec.md :: I45`), and constructing the library starts a check that rejects there with nobody
// awaiting it.
/**
 * The library's instance, whose options and context both carry the session key: the library's own route
 * handler imports it, and every other module calls one of the narrow functions below
 * (`docs/frontend/spec.md :: I545`).
 */
export const auth = new Proxy({} as ReturnType<typeof build>, {
  get: (_, key) => Reflect.get((built ??= build()), key),
  // `toNextJsHandler` asks `"handler" in auth` on every request.
  has: (_, key) => Reflect.has((built ??= build()), key),
});

type CodeSignIn = { readonly email: string; readonly otp: string };

// The body is handed on as it came: `forgiveCodeAttempt` keeps the attempt's failure against that object.
export const signInWithCode = (body: CodeSignIn, requestHeaders: Headers) => auth.api.signInEmailOTP({ body, headers: requestHeaders });

export const sendSignInCode = (email: string, requestHeaders: Headers) =>
  auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: requestHeaders });

export const signOutHere = (requestHeaders: Headers) => auth.api.signOut({ headers: requestHeaders });

export const revokeOtherSessions = (requestHeaders: Headers) => auth.api.revokeOtherSessions({ headers: requestHeaders });

export const renamePasskey = (id: string, name: string, requestHeaders: Headers) =>
  auth.api.updatePasskey({ body: { id, name }, headers: requestHeaders });

/** The fields of a stored session row the account's security page touches; `token` is deliberately not among them. */
export type LiveSessionRow = {
  readonly id: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date;
  readonly authFactor?: unknown;
  readonly passkeyCredentialId?: unknown;
};

/**
 * Every row: a limit left unnamed is the adapter's default of 100, and a sign-in past it would be
 * missing from the list a holder searches for a device they do not know (`docs/frontend/spec.md :: I425`).
 */
const EVERY_ROW = Number.MAX_SAFE_INTEGER;

/**
 * Through the store's own adapter rather than the library's `/list-sessions`, which answers every row
 * whole, `token` included, and that value is the session cookie (`docs/frontend/spec.md :: I420`).
 */
export async function liveSessionsOf(userId: string): Promise<LiveSessionRow[]> {
  const { adapter } = await auth.$context;
  return adapter.findMany<LiveSessionRow>({
    model: "session",
    // Past the library's own expiry a row is dead whatever else holds, so the store never sends it.
    where: [
      { field: "userId", value: userId },
      { field: "expiresAt", operator: "gt", value: new Date() },
    ],
    limit: EVERY_ROW,
  });
}

/**
 * Deletes the holder's session row `id`, by the holder's own user id too, so an id belonging to another
 * person ends nothing (`docs/frontend/spec.md :: I421`); answers how many rows went.
 */
export async function endSessionOf(userId: string, id: string): Promise<number> {
  const { adapter } = await auth.$context;
  return adapter.deleteMany({
    model: "session",
    where: [
      { field: "id", value: id },
      { field: "userId", value: userId },
    ],
  });
}

/**
 * The holder's passkeys, through the store's adapter by the user id a guard served. Never through
 * `auth.api.listPasskeys`, whose own session read slides the row from a render, which cannot write the
 * cookie (`docs/frontend/spec.md :: I496`).
 */
export async function passkeysOf(userId: string): Promise<Passkey[]> {
  const { adapter } = await auth.$context;
  // Enrolments made at once can pass the cap, and a passkey past the default 100 is a card nobody can remove.
  return adapter.findMany<Passkey>({ model: "passkey", where: [{ field: "userId", value: userId }], limit: EVERY_ROW });
}

/** What a removal found inside its transaction, each answered differently by the one caller. */
type PasskeyRemoval = "removed" | "last" | "absent" | "conflict";

/**
 * One transaction around the count, the claim, the delete and the sign-out: two removals started
 * from two rows would otherwise each see a second row and leave none (`docs/frontend/spec.md :: I312`).
 * Exported for `fl_frontend/src/features/passkeys/actions.ts`, the one place a removal happens.
 */
export async function removePasskey(holder: { readonly id: string; readonly verwaltung: boolean }, id: string): Promise<PasskeyRemoval> {
  const { adapter } = await auth.$context;

  // Set once the callback has returned. A throw before that aborted a transaction that never
  // committed, so nothing was written; one after it came from the commit, whose outcome may be unknown.
  let committing = false;

  try {
    return await adapter.transaction(async (held) => {
      const outcome = await removeInside(held);
      committing = true;
      return outcome;
    });
  } catch (failed) {
    // Tested on the whole transaction rather than on the claim alone: another device refreshing or
    // ending its own session meets the sign-out above the same way.
    if (!isWriteConflict(failed)) throw committing ? failed : new RolledBackError(failed);

    // The line is the record: the holder is refused, and nothing else notes that the removal met a
    // change to their passkeys or sessions.
    logger.warn("auth.passkey_removal_conflict", { error_code: "FE-AUTH-005" });
    return "conflict";
  }

  async function removeInside(
    held: Pick<DBTransactionAdapter, "findOne" | "count" | "update" | "delete" | "deleteMany">,
  ): Promise<Exclude<PasskeyRemoval, "conflict">> {
    // The adapter hands itself back where it opens no transaction, and there the claim below
    // conflicts with nothing: refused rather than admitted unguarded.
    if (held === adapter) throw new RemovalOutsideTransaction();

    // By the holder's id as well, so another account's identifier is absent rather than taken; by no
    // window, since enrolments at once can leave more rows than the cap (`docs/frontend/spec.md` §4).
    const removed = await held.findOne<{ credentialID: string }>({
      model: "passkey",
      where: [
        { field: "id", value: id },
        { field: "userId", value: holder.id },
      ],
    });
    if (removed === null) return "absent";
    // By the grant the account page's guard read, which throws on an unread one before any removal:
    // an administrator's last passkey is their only way into the administration, while a person
    // holding none signs in by code again.
    if (holder.verwaltung && (await held.count({ model: "passkey", where: [{ field: "userId", value: holder.id }] })) <= 1) return "last";

    await claimAccount(held, holder.id);
    await held.delete({ model: "passkey", where: [{ field: "id", value: id }] });
    // In the delete's transaction, so a refusal above signs nobody out; by the credential the session
    // recorded, so the devices other passkeys or a code signed in stay (`docs/frontend/spec.md :: I313`).
    await held.deleteMany({
      model: "session",
      where: [
        { field: "userId", value: holder.id },
        { field: "passkeyCredentialId", value: removed.credentialID },
      ],
    });
    return "removed";
  }
}

// React's `cache`: the page's sections share one verdict, and no request another's. A server action
// runs outside a render and asks it once, through `runKontoMutation`.
/**
 * The account page's guard, both lanes' own verdict on the served session: an address holding a grant
 * is admitted by the administrator's guard alone, so a session its mailbox made cannot manage that
 * administrator's passkeys.
 */
export const getKontoSession = cache(async (): Promise<JudgedSession | null> => {
  const served = await readRequestSession();
  if (served === null) return null;

  // An unread grant throws rather than falling to the person's lane, which takes a mailed code. The
  // ban and the grant come in this one lookup, which the person guard of a render shares.
  const subjekt = await lookUpSubjekt(asSignInIdentifier(served.user.email));

  // On every request, as the person guard's: a session its ban's ending missed is no session here (`:: I406`).
  if (subjekt.gesperrt) return null;

  const judged = { ...served, verwaltung: subjekt.verwaltung !== null };
  if (judged.verwaltung) return isAdminSession(served, subjekt) ? judged : null;

  return isWithinPersonLifetime(served.session) ? judged : null;
});

/** The library's own read of the session a request's cookie names, the row's `token` among its fields. */
type LibraryRead = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

/**
 * What every guard below is handed, built fresh off the library's read and never that read whole: the row
 * carries its own `token`, which is the value of the `httpOnly` cookie (`docs/frontend/spec.md :: I198`).
 */
type ServedSession = {
  user: { id: string; email: string; sessionsEndedAt?: Date | null };
  session: Pick<LibraryRead["session"], "id" | "createdAt" | "updatedAt" | "authFactor" | "passkeyCredentialId">;
};

function projected({ user, session }: LibraryRead): ServedSession {
  return {
    user: { id: user.id, email: user.email, sessionsEndedAt: user.sessionsEndedAt ?? null },
    session: {
      // The row's id and never its token: the passkey removal keeps the one session it ran in by it.
      id: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      authFactor: session.authFactor,
      passkeyCredentialId: session.passkeyCredentialId,
    },
  };
}

/**
 * The session the request's cookie names, or `null` where it names none. A store that does not answer
 * throws rather than reading as signed out (`docs/frontend/spec.md :: I519`).
 */
async function readLibrarySession(requestHeaders: Headers, slide: boolean): Promise<ServedSession | null> {
  try {
    const read = await auth.api.getSession({ headers: requestHeaders, query: slide ? {} : { disableRefresh: true } });
    return read === null ? null : projected(read);
  } catch (failed) {
    // The library's word for a row ended between its read and its refresh, which is no session at all;
    // every other throw is the store's, worded `INTERNAL_SERVER_ERROR` and logged as `FE-AUTH-003`.
    if (isAPIError(failed) && failed.status === "UNAUTHORIZED") return null;
    throw failed;
  }
}

/**
 * The session every guard serves. It never slides the session: a page render cannot write the
 * cookie, so a refresh here would carry the row past the cookie the browser holds (`docs/frontend/spec.md :: I496`).
 */
export async function readServedSession(requestHeaders: Headers): Promise<ServedSession | null> {
  return servedSessionOf(await readLibrarySession(requestHeaders, false));
}

// React's `cache`, never `"use cache"`, which would hand one request's session to another: the
// account page's guard, the person guard and the administrator's guard of one render share one read.
/** The session this request's cookie names, as every guard serves it. */
export const readRequestSession = cache(async (): Promise<ServedSession | null> => readServedSession(await headers()));

/**
 * The session the code route's second tab counts as signed in: every guard's read, and none where the
 * sign-in gate refuses the address, a ban its ending missed included (`docs/frontend/spec.md :: I313`, `:: I406`).
 */
export async function readAdmittedSession(requestHeaders: Headers): Promise<ServedSession | null> {
  const served = await readServedSession(requestHeaders);
  if (served === null) return null;

  return (await mayReceiveSignIn(served.user.email)) === "admitted" ? served : null;
}

/**
 * The proxy's read: the proxy runs ahead of the render and can still write a cookie, so the library's
 * refresh past `updateAge` lands whole, `nextCookies()` carrying its cookie onto the proxy's answer
 * (`docs/frontend/spec.md :: I495`).
 */
export async function slideSession(requestHeaders: Headers): Promise<ServedSession | null> {
  return readLibrarySession(requestHeaders, true);
}

/**
 * Whether the account's sessions were ended at or after this one was made, whatever deleted or kept its
 * row (`docs/frontend/spec.md :: I528`).
 */
export function endedByItsAccount({ user, session }: { user: object; session: object }): boolean {
  // Through `Reflect`, as `asStepUpCaller` reads a stamp: the library types a ceremony's read to its own base shape.
  const stamp: unknown = Reflect.get(user, SESSIONS_ENDED_FIELD);
  if (stamp === null || stamp === undefined) return false;

  const created = new Date(Reflect.get(session, "createdAt") as Date | string).getTime();
  const ended = new Date(stamp as Date | string).getTime();

  // An unreadable instant on either side serves nothing, as `withinLifetime` reads an unreadable stamp.
  return !Number.isFinite(created) || !Number.isFinite(ended) || created <= ended;
}

/**
 * `null` where the account's sessions were ended after this one was made, or where a passkey no row
 * holds made it: a sign-in racing that passkey's removal inserts its session after the removal's
 * sign-out ran (`docs/frontend/spec.md :: I313`).
 */
export async function servedSessionOf(served: ServedSession | null): Promise<ServedSession | null> {
  if (served === null || endedByItsAccount(served)) return null;
  if (served.session.authFactor !== PASSKEY_FACTOR) return served;

  const credentialID: unknown = served.session.passkeyCredentialId;
  if (typeof credentialID !== "string" || credentialID === "") return null;

  const { adapter } = await auth.$context;
  const held = await adapter.findOne<{ id: string }>({
    model: "passkey",
    where: [
      { field: "credentialID", value: credentialID },
      { field: "userId", value: served.user.id },
    ],
  });

  return held === null ? null : served;
}

/**
 * A served session beside the grant this request read for its address, which a step-up judges it by.
 * Held for the request alone: a stamp on the stored row would outlive a revoke made in the database.
 */
type JudgedSession = ServedSession & { readonly verwaltung: boolean };

function withinLifetime(session: { createdAt: Date; updatedAt: Date }, lifetime: Lifetime): boolean {
  // Re-read through `Date` rather than trusting the declared type: what reaches here is whatever
  // the adapter deserialised, and a string carries no `getTime` at all.
  const created = new Date(session.createdAt).getTime();
  const updated = new Date(session.updatedAt).getTime();

  // An unreadable stamp is no session rather than an unbounded one. Stated rather than left to
  // NaN's own answer, which the next comparison added here would not inherit.
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;

  const now = Date.now();
  return now - updated < lifetime.idle && now - created < lifetime.absolute;
}

/** Exported for `fl_frontend/src/core/subject.ts`, which judges the same window in its own lane. */
export function isWithinPersonLifetime(session: { createdAt: Date; updatedAt: Date }): boolean {
  return withinLifetime(session, PERSON_LIFETIME);
}

function isAdminWithinWindow(served: ServedSession): boolean {
  return withinLifetime(served.session, ADMIN_LIFETIME);
}

/** Every administrator's condition the grant itself does not decide: a passkey session inside both of the administrator's figures. */
function passesButForItsGrant(served: ServedSession): boolean {
  return isAdminWithinWindow(served) && served.session.authFactor === PASSKEY_FACTOR;
}

/**
 * Whether this served session may act as an administrator — its address holding a grant it was made
 * since, inside both of the administrator's figures, and made by the passkey rather than by a mailed code alone.
 */
export function isAdminSession(served: ServedSession, { verwaltung, berechtigt_seit }: Verwaltung): boolean {
  // A passkey enrolled before the grant still admits, on a sign-in after it: the grant is the privilege,
  // and a passkey the factor it asks, enrolled on the mailbox's own authority (`docs/ops/runbooks.md` §3).
  return verwaltung !== null && madeSince(served.session.createdAt, berechtigt_seit) && passesButForItsGrant(served);
}

/**
 * Why the administrator's guard turned a request away, by what repairs it: a sign-in for `signIn`; no
 * caller for `noGrant`, nor for `grantGone`, a session passing but for its grant; the backend for `unread`.
 */
export type AdminRefusal = "signIn" | "noGrant" | "grantGone" | "unread";

// React's `cache` within a render and `oncePerRequest` within an action, never `"use cache"`, which
// would hand one request's session to another: the backend still judges every call's actor
// (`docs/backend/spec.md :: I383`).
const readAdminRequest = cache(
  oncePerRequest(async (): Promise<{ readonly session: JudgedSession; readonly actor: RequestActor } | { readonly refused: AdminRefusal }> => {
    const served = await readRequestSession();
    if (!served) return { refused: "signIn" };

    // An unread grant admits nobody, so the administration is shut while the backend is.
    const verwaltung = await verwaltungOrNull(served.user.email);
    if (verwaltung === null) return { refused: "unread" };
    if (verwaltung.verwaltung === null) return { refused: passesButForItsGrant(served) ? "grantGone" : "noGrant" };
    // A session made before its grant among them, which a sign-in after the grant repairs.
    if (!isAdminSession(served, verwaltung)) return { refused: "signIn" };

    // A session no token can state truthfully is repaired by signing in afresh.
    const actor = await mintRequestActor(served, "admin");
    if (actor === null) return { refused: "signIn" };

    return { session: { ...served, verwaltung: true }, actor: actor };
  }),
);

/**
 * The administrator's guard with its reason, for a caller whose answer depends on why it refused; every
 * other caller takes `getAdminSession`, over this same read.
 */
export async function judgeAdminRequest(): Promise<{ readonly session: JudgedSession } | { readonly refused: AdminRefusal }> {
  const judged = await readAdminRequest();
  if ("refused" in judged) return judged;

  // On every call, outside the memo: a render's first read may precede every scope, and a later
  // scope answered from the memo would name nobody. The ordering is load-bearing
  // (`docs/frontend/spec.md` §1.3).
  setRequestActor(judged.actor);

  return { session: judged.session };
}

/**
 * Neither throws nor redirects — hence `get`, not `require` — so it guards nothing on its own line.
 * **Check the return value** (`docs/frontend/spec.md` I8).
 */
export async function getAdminSession(): Promise<JudgedSession | null> {
  const judged = await judgeAdminRequest();
  return "session" in judged ? judged.session : null;
}

/** Where `/signin/weiter` sends the session it was handed. */
export type SignInDestination = "/signin/passkey" | "/bereich" | "/signin";

export async function getSignInDestination(): Promise<SignInDestination> {
  return (await landingOf(await headers())).destination;
}

/**
 * The address `/signin` greets rather than offering a sign-in: one the landing would send on
 * anywhere but back to `/signin`, so a spent or unreadable session is offered a fresh sign-in.
 */
export async function getSignedInAddress(): Promise<string | null> {
  const { destination, served } = await landingOf(await headers());
  return destination === "/signin" || served === null ? null : asSignInIdentifier(served.user.email);
}

/** The landing's verdict, and the session it judged where one stands. */
type Landing = { readonly destination: SignInDestination; readonly served: ServedSession | null };

/**
 * Every guard that refuses a session sends it to `/signin`, so this is where one no lane will serve
 * again is ended, whatever missed ending it before (`docs/frontend/spec.md :: I518`).
 */
async function landingOf(requestHeaders: Headers): Promise<Landing> {
  const read = await readLibrarySession(requestHeaders, false);
  if (read === null) return { destination: "/signin", served: null };

  // Past a person's figures no lane serves it, so one past an administrator's alone stands, the person
  // lane still serving it; its passkey gone, none ever will.
  const served = await servedSessionOf(read);
  if (served === null || !isWithinPersonLifetime(read.session)) return ended(read);

  // An unread lookup is the backend down: `/bereich` answers it with the person area's outage panel, its
  // own lookup failing, where `/signin` would mail no code and say nothing (`docs/frontend/spec.md :: I121`).
  const subjekt = await subjektOrNull(served.user.email);
  if (subjekt === null) return { destination: "/bereich", served: served };

  // The ban itself, never read through the grant: every guard behind `/bereich` refuses a barred session,
  // and one left standing serves again on the ban's lift with no sign-in (`docs/frontend/spec.md :: I406`).
  if (subjekt.gesperrt) return ended(read);

  return { destination: await destinationOf(served, subjekt), served: served };
}

/**
 * Deleted by the row's id, never its token, which leaves the store for nothing. The browser keeps a
 * cookie naming no row, which every read answers as no session.
 */
async function ended(read: ServedSession): Promise<Landing> {
  const { adapter } = await auth.$context;
  await adapter.delete({ model: "session", where: [{ field: "id", value: read.session.id }] });
  return { destination: "/signin", served: null };
}

async function destinationOf(served: ServedSession, verwaltung: Verwaltung): Promise<SignInDestination> {
  if (verwaltung.verwaltung !== null) {
    // The guard's own verdict rather than a second spelling of it: `/bereich` sends a granted session
    // the guard refuses on to `/bereich/admin`, which the proxy bounces back here.
    if (isAdminSession(served, verwaltung)) return "/bereich";

    // Where the passkey page has no step to offer, the session is spent, and an administrator signs in
    // afresh rather than being sent to a person's landing with no way to the step they owe.
    return (await passkeyStepOf(served, true)) === null ? "/signin" : "/signin/passkey";
  }

  return (await passkeyStepOf(served, false)) === "offer" ? "/signin/passkey" : "/bereich";
}

/**
 * Which card `/signin/passkey` shows: an administrator's required enrolment or assertion, or the
 * passkey offered to a person, whose „Später“ goes on to `/bereich`.
 */
export type PasskeyStep = { readonly step: "enrol" | "assert" | "offer"; readonly email: string };

/**
 * The one answer both functions around it give, so the landing never sends a session to a page that
 * then has nothing to show it and sends it back.
 */
async function passkeyStepOf(served: ServedSession, admin: boolean): Promise<PasskeyStep["step"] | null> {
  if (admin ? !isAdminWithinWindow(served) : !isWithinPersonLifetime(served.session)) return null;
  // A session the passkey already made needs no card, whatever it holds.
  if (served.session.authFactor === PASSKEY_FACTOR) return null;

  // Past it `refuseEnrolment` refuses the enrolment, so no card offers one.
  const mayEnrol = isWithinEnrolmentWindow(served.session.createdAt);
  if (!admin && !mayEnrol) return null;

  // The question `refuseEnrolment` puts to the adapter, by the same user id: they agree or the page
  // offers a control the server refuses.
  const held = await passkeysOf(served.user.id);

  if (held.length > 0) return admin ? "assert" : null;
  if (!mayEnrol) return null;

  return admin ? "enrol" : "offer";
}

/** `null` where that page is not the caller's to see. */
export async function getPasskeyStep(): Promise<PasskeyStep | null> {
  const served = await readRequestSession();
  if (!served) return null;

  // An unread read offers no card, for the landing's reason; a barred subject none either, its
  // enrolment being refused (`docs/frontend/spec.md :: I406`).
  const subjekt = await subjektOrNull(served.user.email);
  if (subjekt === null || subjekt.gesperrt) return null;

  const step = await passkeyStepOf(served, subjekt.verwaltung !== null);
  if (step === null) return null;

  // Folded as `getAdminSession` folds the actor it records: the stored row is the library's own
  // spelling, and this is the one address of this slice a person reads.
  return { step: step, email: asSignInIdentifier(served.user.email) };
}

/**
 * Ends every live session of the account an address holds, which the refusal of its next sign-in does
 * not reach; the account and its passkeys stay for the day the ban ends (`docs/frontend/spec.md :: I402`).
 */
export async function endSessionsOfAddress(address: string): Promise<boolean> {
  // No grant is asked about: a ban ends every session of the address it names, whatever it holds.
  const folded = asSignInIdentifier(address);

  const { adapter } = await auth.$context;

  // The stamp ends them, and before any row is deleted: a deletion failing below leaves rows no guard
  // serves, a lift of the ban included (`docs/frontend/spec.md :: I528`). Equality on the stored
  // address, which every sign-in stores folded.
  const account = await adapter.update<{ id: string }>({
    model: "user",
    where: [{ field: "email", value: folded }],
    update: { [SESSIONS_ENDED_FIELD]: new Date() },
  });
  // Answered from the stamp, never the deletion, so a failed deletion keeps the mail it owes (`:: I517`).
  if (account === null) return false;

  try {
    // By the account, never by a token: no session's cookie value leaves the store for this.
    await adapter.deleteMany({ model: "session", where: [{ field: "userId", value: account.id }] });
  } catch (failed) {
    // Logged and left: the rows stand served by no lane, and the landing deletes each its browser brings back.
    logger.error("auth.ended_sessions_not_deleted", undefined, {
      error_code: "FE-AUTH-006",
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
  return true;
}
