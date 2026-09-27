import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth, getCurrentAdapter } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { customSession } from "better-auth/plugins/custom-session";
import { emailOTP } from "better-auth/plugins/email-otp";
import { MongoServerError } from "mongodb";

import { mintRequestActor } from "./actorToken";
import { ANMELDUNG_CODE, ANMELDUNG_TAG } from "./anmeldeTag";
import { buildCodeEmail, CODE_VALIDITY_MINUTES } from "./authEmail";
import { frontend_config } from "./config";
import { client } from "./db";
import { asSignInIdentifier } from "./emailAddress";
import { BRAND_NAME } from "./emailShell";
import { RolledBackError } from "./errors";
import { KONTO_HREF } from "./kontoHref";
import { logger } from "./logging";
import { sendMail } from "./mail";
import { buildPasskeyGeloeschtEmail, buildPasskeyHinzugefuegtEmail } from "./passkeyEmail";
import { passkeyLastUse } from "./passkeyLastUse";
import { ENROLMENT_CONFLICT, SIGN_IN_BARRED, SIGN_IN_HOLDS_NOTHING, USER_VERIFICATION_REFUSED } from "./passkeyRefusal";
import { setRequestActor } from "./requestScope";
import {
  ADMIN_LIFETIME,
  isWithinEnrolmentWindow,
  isWithinStepUpWindow,
  PERSON_LIFETIME,
  SESSION_EXPIRES_IN_DAYS,
  STEP_UP_WINDOW_MS,
} from "./sessionLifetimes";
import { CODE_FAILURE_LIMIT, CODE_FAILURE_WINDOW_HOURS, CODE_MAIL_LIMIT, CODE_MAIL_WINDOW_HOURS, SIGN_IN_CODE_LENGTH } from "./signInCode";
import { lookUpSubjekt, mayReceiveSignIn, signInVerdictOf } from "./signInGate";
import { verwaltungOf } from "./verwaltung";

import type { AuthContext, BetterAuthOptions, DBTransactionAdapter, GenericEndpointContext } from "better-auth";
import type { PasskeyEmail } from "./passkeyEmail";
import type { RequestActor } from "./requestScope";
import type { Lifetime } from "./sessionLifetimes";
import type { SubjectSession } from "./subject";

/** One mailbox's records, ban and grant, as the gate reads them. */
type SubjectRecords = SubjectSession["subjekt"];

// Named for what the database holds rather than for the library that writes it, so the next swap
// inherits a name it does not have to migrate.
const MONGO_DB_NAME = "auth";

// A ceiling nothing else supplies: one session that passed the assertion can enrol without limit
// (`docs/frontend/spec.md :: I311`).
export const PASSKEY_LIMIT = 5;

const SESSION_EXPIRES_IN_SECONDS = SESSION_EXPIRES_IN_DAYS * 24 * 60 * 60;

// What the refresh costs, and so how closely `updatedAt` tracks activity: the idle windows in
// `fl_frontend/src/core/sessionLifetimes.ts` are compared against it, and this is the width of their
// granularity.
const SESSION_UPDATE_AGE_SECONDS = 60 * 60;

const CODE_VALIDITY_SECONDS = CODE_VALIDITY_MINUTES * 60;

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

// The assertion's session-creating path, read off `@better-auth/passkey` 1.7.5 on 2026-09-20: its
// `signIn.passkey` is a client helper over two endpoints rather than a route.
const PASSKEY_ASSERTION_PATH = "/passkey/verify-authentication";

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

// The assertion's ask travels through `patches/@better-auth__passkey@1.7.5.patch`, whose hunk in
// `generatePasskeyAuthenticationOptions` better-auth pull request 11155 retires; the check is ours
// either way, both verifiers being called with `requireUserVerification` off.
const USER_VERIFICATION: "required" | "preferred" = "required";

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
 * The records an enrolment is judged by, where an unread read must refuse rather than admit: an
 * enrolment held to the passkey for an administrator would otherwise relax to a person's, by mailed
 * code, while the backend is down.
 */
async function enrolmentSubjekt(email: string): Promise<SubjectRecords> {
  try {
    return await lookUpSubjekt(asSignInIdentifier(email));
  } catch (failed) {
    logUnreadVerwaltung(failed);
    throw APIError.fromStatus("SERVICE_UNAVAILABLE");
  }
}

/**
 * The grant an enrolment is judged by. A barred address enrols nothing, whatever it holds: its session
 * is one a ban's ending missed or a mint raced, and a passkey would outlive both (`docs/frontend/spec.md :: I406`).
 */
function enrolmentGrant(subjekt: SubjectRecords): boolean {
  if (subjekt.gesperrt) throw APIError.fromStatus("NOT_FOUND");
  return subjekt.verwaltung !== null;
}

/**
 * The caller's records, read in the registration's before hook and carried on the endpoint's context
 * into its transaction, whose checks then decide without a backend round trip holding it open.
 */
type EnrolmentRead = { readonly userId: string; readonly subjekt: SubjectRecords };

/** The context key the carried read travels under; a string, the library merging no symbol key. */
const ENROLMENT_READ = "flEnrolmentRead";

/** The read the before hook carried for `userId`, or `undefined` where it carried none for them. */
function carriedEnrolmentRead(ctx: object | undefined, userId: string): SubjectRecords | undefined {
  const read: unknown = ctx === undefined ? undefined : Reflect.get(ctx, ENROLMENT_READ);
  if (typeof read !== "object" || read === null) return undefined;

  return Reflect.get(read, "userId") === userId ? (Reflect.get(read, "subjekt") as SubjectRecords) : undefined;
}

/** The carried read, or the default-deny net's refusal where the hook carried none for this caller. */
function carriedOrRefuse(ctx: object, userId: string): SubjectRecords {
  const read = carriedEnrolmentRead(ctx, userId);
  if (read === undefined) throw APIError.fromStatus("NOT_FOUND");
  return read;
}

/** The records where an unread read offers nothing: `null` where the backend could not say. */
async function subjektOrNull(email: string): Promise<SubjectRecords | null> {
  try {
    return await lookUpSubjekt(asSignInIdentifier(email));
  } catch (failed) {
    logUnreadVerwaltung(failed);
    return null;
  }
}

/** The grant where an unread one admits nobody: `null` where the backend could not say. */
async function verwaltungOrNull(email: string): Promise<boolean | null> {
  try {
    return (await verwaltungOf(email)) !== null;
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
  // rows nothing on the page tells apart (driven against 1.7.5).
  if (credentialID !== undefined && held.some((row) => row.credentialID === credentialID)) throw APIError.fromStatus("NOT_FOUND");
}

// The server's code for a write refused over another transaction's write to the same document; the
// driver exports no name for it.
const WRITE_CONFLICT = 112;

function isWriteConflict(failed: unknown): boolean {
  // The code, not the `TransientTransactionError` label: the driver labels a lost connection and a
  // stepped-down primary that way too, and neither is another change to these passkeys.
  return failed instanceof MongoServerError && failed.code === WRITE_CONFLICT;
}

/** Named, because the library's failure line records an error's name and nothing else. */
class EnrolmentOutsideTransaction extends Error {
  override name = "EnrolmentOutsideTransaction";
}

/** Named for the same reason as the class above. */
class ClaimMatchedNoAccount extends Error {
  override name = "ClaimMatchedNoAccount";
}

/** Named for the same reason as `EnrolmentOutsideTransaction`, whose removal twin this is. */
class RemovalOutsideTransaction extends Error {
  override name = "RemovalOutsideTransaction";
}

/**
 * The write every enrolment and every removal of one administrator makes, inside the transaction
 * holding its count and its passkey write: the database refuses the second of two, where the count
 * alone admits both (`docs/frontend/spec.md :: I341`).
 */
async function claimAccount(adapter: Pick<DBTransactionAdapter, "update">, userId: string): Promise<void> {
  // Any field of the account's own row conflicts; `updatedAt` is one the row already carries, so the
  // claim stores nothing new about the administrator.
  const claimed = await adapter.update({ model: "user", where: [{ field: "id", value: userId }], update: { updatedAt: new Date() } });

  // A claim on no row conflicts with nothing, which is the enrolment the transaction exists to refuse.
  if (claimed === null) throw new ClaimMatchedNoAccount();
}

/** Named for the same reason as `EnrolmentOutsideTransaction`. */
class CeremonyNamedNoCredential extends Error {
  override name = "CeremonyNamedNoCredential";
}

/** `ctx.body.response.id` read without trusting the body's shape, which is whatever the caller posted. */
function declaredCredentialId(ctx: Pick<GenericEndpointContext, "body">): unknown {
  const response: unknown = typeof ctx.body === "object" && ctx.body !== null ? Reflect.get(ctx.body, "response") : undefined;
  return typeof response === "object" && response !== null ? Reflect.get(response, "id") : undefined;
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

/**
 * Ends the session the request's cookie named once a sign-in has minted its successor: a step-up
 * would otherwise leave the session it replaced alive beside the new one (`docs/frontend/spec.md :: I399`).
 */
async function endReplacedSession(ctx: GenericEndpointContext, mintedToken: string): Promise<void> {
  // The cookie rather than `getSessionFromCtx`, whose read refreshes the replaced row and writes a
  // `Set-Cookie` for it into the very response that carries the new one.
  const replaced = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
  if (typeof replaced !== "string" || replaced === "" || replaced === mintedToken) return;

  try {
    await ctx.context.internalAdapter.deleteSession(replaced);
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
async function refuseUnadmitted(ctx: GenericEndpointContext, userId: string): Promise<void> {
  const account = await ctx.context.internalAdapter.findUserById(userId);
  // Inside a registration's transaction the before hook's read decides, never a second round trip.
  const carried = carriedEnrolmentRead(ctx, userId);
  const verdict =
    account === null
      ? "failed"
      : carried === undefined
        ? await mayReceiveSignIn(account.email)
        : signInVerdictOf(asSignInIdentifier(account.email), carried);
  if (verdict === "admitted") return;

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

/** Whether every address together has already been mailed the hour's total: a read alone, writing nothing. */
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

/* The library mounts forty endpoints and an upgrade adds more, so the surface is closed from two
   sides: the documented switch below, and the default-deny hook that also covers what it cannot. */

// What a browser of this league calls: `fl_frontend/src/core/authClient.ts`'s two ceremonies, four
// paths. The sign-in, the sign-out and every guard run in process instead.

// Two spellings come from the constants the stamp and the enrolment refusal compare, so a release
// that renamed either would 404 the real ceremony rather than let it through unjudged.
const BROWSER_PATHS: ReadonlySet<string> = new Set([...ENROLMENT_PATHS, "/passkey/generate-authenticate-options", PASSKEY_ASSERTION_PATH]);

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
    await sendMail({ to: email, subject: message.subject, html: message.html, text: message.text });
  } catch (failed) {
    // Name only, as the code's own send writes one: a failure here routinely carries the address.
    logger.error("auth.passkey_notice_failed", undefined, {
      error_code: "FE-AUTH-004",
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/** Exported for `fl_frontend/src/features/passkeys/actions.ts`, the one place a removal happens. */
export async function notifyPasskeyRemoved(email: string): Promise<void> {
  await notify(buildPasskeyGeloeschtEmail({ zeitpunkt: new Date(), origin: MAIL_ORIGIN, konto: KONTO_HREF }), email);
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
];

const LIBRARY_EVENT_UNKNOWN = "auth.library_failed";

// Both halves of the WebAuthn binding come from here.

// The fallback is reached only while the image builds, where the environment is empty
// (`docs/frontend/spec.md :: I45`); its `.invalid` host matches no browser's origin, so one that
// escaped the builder would refuse rather than enrol.
const AUTH_ORIGIN = new URL(frontend_config.AUTH_URL ?? "https://auth-url-unset.invalid");

/** The serving origin a notice below is composed on, never `brand.ts :: SITE_URL` (I186). */
const MAIL_ORIGIN = frontend_config.AUTH_URL ?? AUTH_ORIGIN.origin;

/**
 * Bound to a name because `customSession` below is typed off it: the projection's `session`
 * argument carries the added field only where it is handed this same declaration.
 */
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
  },
} satisfies BetterAuthOptions["session"];

const authOptions = {
  // The `Db` off the one client this process opens, never a second connection
  // (`docs/frontend/spec.md :: I120`).
  database: mongodbAdapter(client.db(MONGO_DB_NAME), { client }),

  // Passed rather than left to the environment: the library reads no bare `AUTH_URL`, and this
  // value's origin also decides the `__Host-` cookie prefix below and the passkey relying-party id.
  baseURL: frontend_config.AUTH_URL ?? AUTH_ORIGIN.origin,
  secret: frontend_config.AUTH_SECRET,

  session: sessionOptions,

  // The library stores the caller's address on every session row, and nothing here reads one: the
  // limiter that would is off below (`docs/ops/spec.md :: I4`).

  advanced: {
    // The edge's own access line already carries the address, under a bound (`docs/datenschutz.md` §6).
    ipAddress: { disableIpTracking: true },
    // Host-bound over https (`docs/frontend/spec.md :: I401`). Through the prefix and never a cookie
    // name: the library puts `__Secure-` ahead of any name while `useSecureCookies` is on, and a
    // `__Secure-__Host-` cookie is bound to no host.
    ...(AUTH_ORIGIN.protocol === "https:" ? { useSecureCookies: false, cookiePrefix: `__Host-${MONGO_DB_NAME}` } : {}),
  },

  databaseHooks: {
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
          await refuseUnadmitted(ctx, session.userId);

          return {
            data: {
              ...session,
              // Emptied here because the library offers no switch for it, beside the one above that
              // empties the address: a second copy of the caller under no retention clock.
              userAgent: "",
              authFactor: factor,
              ...(factor === PASSKEY_FACTOR ? { passkeyCredentialId: ceremonyCredentialId(ctx) } : {}),
            },
          };
        },
        // Right after the insert, past every refusal; after the commit only for a set-up that signs in.
        // On the assertion and code paths a failed user read or cookie write still signs the caller out.
        after: async (session, ctx) => {
          if (!ctx) return;
          await endReplacedSession(ctx, session.token);
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

      // Above the in-process return, so both arms carry it: the registration's transaction opens later,
      // and a backend round trip inside it would hold it open (`docs/frontend/spec.md :: I462`).
      const enrolling = ctx.path === PASSKEY_REGISTRATION_PATH ? await getSessionFromCtx(ctx) : null;
      const enrolmentRead: EnrolmentRead | undefined =
        enrolling === null ? undefined : { userId: enrolling.user.id, subjekt: await enrolmentSubjekt(enrolling.user.email) };
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
      if (caller === null) throw APIError.fromStatus("NOT_FOUND");

      await refuseEnrolment(
        ctx.context.adapter,
        caller.user.id,
        asStepUpCaller(caller, enrolmentGrant(enrolmentRead?.subjekt ?? (await enrolmentSubjekt(caller.user.email)))),
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

      if (!CEREMONY_VERIFY_PATHS.has(ctx.path)) return undefined;

      // Left standing where the ceremony was refused, or a refusal is answered as a success.
      if (isAPIError(ctx.context.returned)) return undefined;

      // Here rather than in the callback above, which runs BEFORE the write: a notice sent there
      // would name an enrolment a later refusal never made.
      if (ctx.path === PASSKEY_REGISTRATION_PATH) {
        const enrolled = await getSessionFromCtx(ctx);
        if (enrolled !== null) {
          await notify(buildPasskeyHinzugefuegtEmail({ zeitpunkt: new Date(), origin: MAIL_ORIGIN, konto: KONTO_HREF }), enrolled.user.email);
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
        const { subject, html, text } = buildCodeEmail(otp, frontend_config.AUTH_URL);

        try {
          // Tagged so the delivery webhook can tell this lane from the application flow's and put
          // a bounce on the stream: a mailbox refusing the code locks out whoever holds no passkey,
          // and an untagged event reaches no reader at all.
          await sendMail({ to: email, subject, html, text, tags: { [ANMELDUNG_TAG]: ANMELDUNG_CODE } });
        } catch (failed) {
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

    // `authenticatorSelection` carries the ask into both ceremonies' options; the library verifies
    // the flag on neither response, so `afterVerification` below is the whole of the check.
    passkey({
      rpName: BRAND_NAME,
      // Named rather than left to the plugin's own derivation, which answers this same host off
      // `baseURL`: what an enrolled passkey is bound to for life outlives that option.
      rpID: AUTH_ORIGIN.hostname,
      // Unset, this is the caller's own `Origin` header -- a ceremony checked against the value its
      // own sender chose.
      origin: AUTH_ORIGIN.origin,
      authenticatorSelection: { userVerification: USER_VERIFICATION, residentKey: "required" },
      // Both callbacks run before the plugin writes anything -- ahead of the passkey row, and ahead
      // of the counter and the session -- so a refusal here leaves the store as it found it.
      registration: {
        afterVerification: async ({ ctx, verification, user }) => {
          refuseUnverified(verification.registrationInfo?.userVerified === true);

          // The verifier holds the posted `id` to `rawId` and neither to the attested credential, so
          // a session this enrolment mints would otherwise name whichever passkey its caller chose.
          if (declaredCredentialId(ctx) !== verification.registrationInfo?.credential.id) throw APIError.fromStatus("BAD_REQUEST");

          // The transaction `patches/@better-auth__passkey@1.7.5.patch` opens around every
          // registration. Outside one the claim below conflicts with nothing, so an enrolment
          // arriving without it is refused rather than admitted unguarded.
          const adapter = await getCurrentAdapter(ctx.context.adapter);
          if (adapter === ctx.context.adapter) throw new EnrolmentOutsideTransaction();

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

          try {
            await claimAccount(adapter, user.id);
          } catch (failed) {
            if (!isWriteConflict(failed)) throw failed;

            // The line is the record: under a stolen mailbox racing the administrator, this refusal
            // is the only trace that a second enrolment ran.
            logger.warn("auth.passkey_enrolment_conflict", { error_code: "FE-AUTH-005" });
            throw new APIError("CONFLICT", {
              code: ENROLMENT_CONFLICT,
              message: "Another change to this account's passkeys ran at the same time.",
            });
          }
        },
      },
      authentication: { afterVerification: ({ verification }) => refuseUnverified(verification.authenticationInfo.userVerified) },
    }),

    passkeyLastUse(),

    // Built fresh, never the served object returned whole: the session row carries its own `token`,
    // which is the value of the `httpOnly` cookie (`docs/frontend/spec.md :: I198`).
    customSession(
      async ({ user, session }) => ({
        user: { id: user.id, email: user.email },
        session: {
          // The row's id and never its token: the passkey removal keeps the one session it ran in by it.
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          authFactor: session.authFactor,
          passkeyCredentialId: session.passkeyCredentialId,
        },
      }),
      { session: sessionOptions },
    ),

    // Last, which the library warns about: it copies a response's `set-cookie` into Next's store.
    nextCookies(),
  ],
} satisfies BetterAuthOptions;

const build = () => betterAuth(authOptions);
let built: ReturnType<typeof build> | undefined;

// Built on first use rather than at import: `next build` loads this module in every page-data worker with the secret
// undefined (`docs/frontend/spec.md :: I45`), and constructing the library starts a check that rejects there with nobody
// awaiting it.
export const auth = new Proxy({} as ReturnType<typeof build>, {
  get: (_, key) => Reflect.get((built ??= build()), key),
  // `toNextJsHandler` asks `"handler" in auth` on every request.
  has: (_, key) => Reflect.has((built ??= build()), key),
});

/** What a removal found inside its transaction, each answered differently by the one caller. */
type PasskeyRemoval = "removed" | "last" | "absent" | "conflict";

/**
 * One transaction around the count, the claim, the delete and the sign-out: two removals started
 * from two rows would otherwise each see a second row and leave none (`docs/frontend/spec.md :: I312`).
 * Exported for `fl_frontend/src/features/passkeys/actions.ts`, the one place a removal happens.
 */
export async function removePasskey(holder: { id: string; email: string }, id: string): Promise<PasskeyRemoval> {
  const { adapter } = await auth.$context;
  // Judged here rather than by the caller: an administrator's last passkey is their only way into
  // the administration, while a person holding none signs in by code again. An unread grant throws
  // rather than let a last passkey go.
  const keepsLast = (await verwaltungOf(holder.email)) !== null;

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
    held: Pick<DBTransactionAdapter, "findMany" | "update" | "delete" | "deleteMany">,
  ): Promise<Exclude<PasskeyRemoval, "conflict">> {
    // The adapter hands itself back where it opens no transaction, and there the claim below
    // conflicts with nothing: refused rather than admitted unguarded, as the enrolment is.
    if (held === adapter) throw new RemovalOutsideTransaction();

    const rows = await held.findMany<{ id: string; credentialID: string }>({
      model: "passkey",
      where: [{ field: "userId", value: holder.id }],
      limit: PASSKEY_LIMIT + 1,
    });

    // Read off the holder's own rows, so another account's identifier is absent rather than taken.
    const removed = rows.find((row) => row.id === id);
    if (removed === undefined) return "absent";
    if (keepsLast && rows.length <= 1) return "last";

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

// React's `cache`, as `getAdminSession` is: the page's sections and a server action's body share one
// read, and no request another's.
/**
 * The account page's guard, both lanes' own verdict on the served session: an address holding a grant
 * is admitted by the administrator's guard alone, so a session its mailbox made cannot manage that
 * administrator's passkeys.
 */
export const getKontoSession = cache(async (): Promise<JudgedSession | null> => {
  const served = await auth.api.getSession({ headers: await headers() });
  if (served === null) return null;

  // An unread grant throws rather than falling to the person's lane, which takes a mailed code. The
  // lookup `verwaltungOf` reads, memoised per render, so the ban costs no second read.
  const subjekt = await lookUpSubjekt(asSignInIdentifier(served.user.email));

  // On every request, as the person guard's: a session its ban's ending missed is no session here (`:: I406`).
  if (subjekt.gesperrt) return null;

  const judged = { ...served, verwaltung: subjekt.verwaltung !== null };
  if (judged.verwaltung) return isAdminSession(served, true) ? judged : null;

  return isWithinPersonLifetime(served.session) ? judged : null;
});

/** What every guard below is handed; no HTTP route serves it, `/get-session` being disabled. */
type ServedSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

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

// An address granted after its session was made is an administrator on the next request, and is
// judged against the administrator's window on that same request.
function isAdminWithinWindow(served: ServedSession, verwaltung: boolean): boolean {
  return verwaltung && withinLifetime(served.session, ADMIN_LIFETIME);
}

/**
 * Whether this served session may act as an administrator — its address holding a grant, inside both
 * of the administrator's figures, and made by the passkey rather than by a mailed code alone.
 */
export function isAdminSession(served: ServedSession, verwaltung: boolean): boolean {
  return isAdminWithinWindow(served, verwaltung) && served.session.authFactor === PASSKEY_FACTOR;
}

/**
 * Why the administrator's guard turned a request away, by what repairs it: a sign-in for `signIn`; no
 * caller for `noGrant`, nor for `grantGone`, a session passing but for its grant; the backend for `unread`.
 */
export type AdminRefusal = "signIn" | "noGrant" | "grantGone" | "unread";

// React's `cache`, never `"use cache"`, which would hand one request's session to another: one read
// and one signed actor serve every guard of a render pass, and none outside it, where a server action
// and the proxy each read theirs.
const readAdminRequest = cache(
  async (): Promise<{ readonly session: JudgedSession; readonly actor: RequestActor } | { readonly refused: AdminRefusal }> => {
    const served = await auth.api.getSession({ headers: await headers() });
    if (!served) return { refused: "signIn" };

    // An unread grant admits nobody, so the administration is shut while the backend is.
    const verwaltung = await verwaltungOrNull(served.user.email);
    if (verwaltung === null) return { refused: "unread" };
    if (!verwaltung) return { refused: isAdminSession(served, true) ? "grantGone" : "noGrant" };
    if (!isAdminSession(served, true)) return { refused: "signIn" };

    // A session no token can state truthfully is repaired by signing in afresh.
    const actor = await mintRequestActor(served, "admin");
    if (actor === null) return { refused: "signIn" };

    return { session: { ...served, verwaltung: true }, actor: actor };
  },
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
export type SignInDestination = "/bereich/admin" | "/signin/passkey" | "/bereich" | "/signin";

export async function getSignInDestination(): Promise<SignInDestination> {
  const requestHeaders = await headers();
  return signInDestinationOf(await auth.api.getSession({ headers: requestHeaders }), requestHeaders);
}

/**
 * The address `/signin` greets rather than offering a sign-in: one the landing would send on
 * anywhere but back to `/signin`, so a spent or unreadable session is offered a fresh sign-in.
 */
export async function getSignedInAddress(): Promise<string | null> {
  const requestHeaders = await headers();
  const served = await auth.api.getSession({ headers: requestHeaders });
  if ((await signInDestinationOf(served, requestHeaders)) === "/signin" || served === null) return null;

  return asSignInIdentifier(served.user.email);
}

async function signInDestinationOf(served: ServedSession | null, requestHeaders: Headers): Promise<SignInDestination> {
  if (!served) return "/signin";

  // An unread grant is the backend down: `/bereich` answers it with the person area's outage panel, its
  // own lookup failing, where `/signin` would mail no code and say nothing (`docs/frontend/spec.md :: I121`).
  const verwaltung = await verwaltungOrNull(served.user.email);
  if (verwaltung === null) return isWithinPersonLifetime(served.session) ? "/bereich" : "/signin";

  if (verwaltung) {
    // The guard's own verdict rather than a second spelling of it: a condition added there has to
    // move this landing with it, or `/bereich/admin` is offered to somebody the proxy bounces.

    // eslint-disable-next-line local/admin-link -- where a finished sign-in lands; no season is in scope at sign-in
    if (isAdminSession(served, true)) return "/bereich/admin";

    // Where the passkey page has no step to offer, the session is spent, and an administrator signs in
    // afresh rather than being sent to a person's landing with no way to the step they owe.
    return (await passkeyStepOf(served, true, requestHeaders)) === null ? "/signin" : "/signin/passkey";
  }

  if (!isWithinPersonLifetime(served.session)) return "/signin";

  return (await passkeyStepOf(served, false, requestHeaders)) === "offer" ? "/signin/passkey" : "/bereich";
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
async function passkeyStepOf(served: ServedSession, admin: boolean, requestHeaders: Headers): Promise<PasskeyStep["step"] | null> {
  if (admin ? !isAdminWithinWindow(served, true) : !isWithinPersonLifetime(served.session)) return null;
  // A session the passkey already made needs no card, whatever it holds.
  if (served.session.authFactor === PASSKEY_FACTOR) return null;

  // Past it `refuseEnrolment` refuses the enrolment, so no card offers one.
  const mayEnrol = isWithinEnrolmentWindow(served.session.createdAt);
  if (!admin && !mayEnrol) return null;

  // The same question `refuseEnrolment` puts to the adapter, asked here through the plugin: they
  // agree or the page offers a control the server refuses, which `fl_frontend/src/core/auth.test.ts`
  // drives over one row.
  const held = await auth.api.listPasskeys({ headers: requestHeaders });

  if (held.length > 0) return admin ? "assert" : null;
  if (!mayEnrol) return null;

  return admin ? "enrol" : "offer";
}

/** `null` where that page is not the caller's to see. */
export async function getPasskeyStep(): Promise<PasskeyStep | null> {
  const requestHeaders = await headers();

  const served = await auth.api.getSession({ headers: requestHeaders });
  if (!served) return null;

  // An unread read offers no card, for the landing's reason; a barred subject none either, its
  // enrolment being refused (`docs/frontend/spec.md :: I406`).
  const subjekt = await subjektOrNull(served.user.email);
  if (subjekt === null || subjekt.gesperrt) return null;

  const step = await passkeyStepOf(served, subjekt.verwaltung !== null, requestHeaders);
  if (step === null) return null;

  // Folded as `getAdminSession` folds the actor it records: the stored row is the library's own
  // spelling, and this is the one address of this slice a person reads.
  return { step: step, email: asSignInIdentifier(served.user.email) };
}

/**
 * Ends every live session of the account an address holds, which the refusal of its next sign-in does
 * not reach; the account and its passkeys stay for the day the ban ends (`docs/frontend/spec.md :: I402`).
 */
export async function endSessionsOfAddress(address: string): Promise<void> {
  // No grant is asked about: a ban and a grant each end every session of the address they name,
  // whatever it holds.
  const folded = asSignInIdentifier(address);

  const { adapter } = await auth.$context;

  // Equality on the stored address: every sign-in hands the library the folded form, which it stores
  // lower-cased and so unchanged.
  const account = await adapter.findOne<{ id: string }>({ model: "user", where: [{ field: "email", value: folded }] });
  if (account === null) return;

  // By the account, never by a token: no session's cookie value leaves the store for this.
  await adapter.deleteMany({ model: "session", where: [{ field: "userId", value: account.id }] });
}
