import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { getSessionCookie, SECURE_COOKIE_PREFIX } from "better-auth/cookies";
import { makeSignature, signJWT, verifyJWT } from "better-auth/crypto";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";

import { MONGO_DB_NAME } from "../authIndexes";
import { now } from "../clock";
import { authSecret, frontend_config } from "../config";
import { COPY } from "../copy/shared";
import { signInStore } from "../db";
import { asSignInIdentifier } from "../emailAddress";
import { ERASURE_LINK_VALID_HOURS } from "../erasureEmail";
import { identityPostAccountErasure } from "../generated/client/sdk";
import { logger } from "../logging";
import { declaredCredentialId, PASSKEY_ASSERTION_PATH } from "../passkeyCeremony";
import { getRequestActor } from "../requestScope";
import { ADMIN_LIFETIME, SESSION_EXPIRES_IN_DAYS } from "../sessionLifetimes";
import {
  CODE_ATTEMPTS,
  CODE_FAILURE_LIMIT,
  CODE_FAILURE_WINDOW_HOURS,
  CODE_MAIL_LIMIT,
  CODE_MAIL_WINDOW_HOURS,
  CODE_VALIDITY_MINUTES,
  SIGN_IN_CODE_LENGTH,
} from "../signInCode";
import { mayReceiveSignIn } from "../signInGate";
import { HOUR_MS } from "../timeUnits";
import { readTraceparent, TRACEPARENT_HEADER } from "../trace";
import { assertionAnswer } from "./assertionAnswer";
import { ceremonyCredentialId, challengeIssuedAt, isDuplicateCredential, refuseAnotherAccountsPasskey } from "./ceremony";
import { ENROLMENT_READ, refuseBarred, refuseEnrolment, refuseWithoutGrant } from "./enrolment";
import { enrolmentSignIn } from "./gateReads";
import { notifyPasskey, oweSignInMail, sendDeletionLink } from "./mails";
import { endReplacedSession, lineageOf, refuseUnadmitted, replacedToken } from "./minting";
import { ADDRESS_ATTEMPTS_EXHAUSTED, CODE_NOT_ASKED_HERE } from "./refusalCodes";
import {
  CODE_FACTOR,
  endedByItsAccount,
  FRESH_SIGN_IN_SECONDS,
  PASSKEY_FACTOR,
  REPLACED_SESSION_FIELD,
  SESSIONS_ENDED_FIELD,
  stampsOf,
  withinLifetime,
} from "./sessionStamps";
import {
  attemptRows,
  boundIdentifier,
  clearCodeFailures,
  CODE_ROW_PREFIX,
  deleteSignInRowsOf,
  deletionLinkCapped,
  FAILURE_ROW_PREFIX,
  MAIL_ROW_PREFIX,
  nextCodeStamp,
  refusedAtMint,
  settleCodeAttempt,
  unlessUnsettled,
  withinBound,
} from "./signInRows";

import type { BetterAuthOptions, GenericEndpointContext } from "better-auth";
import type { MongoClient } from "mongodb";
import type { EnrolmentRead } from "./enrolment";
import type { AuthFactor } from "./sessionStamps";

const SESSION_EXPIRES_IN_SECONDS = SESSION_EXPIRES_IN_DAYS * 24 * 60 * 60;

// A pause shorter than the administrator's idle hour can still be refused once it and this reach the
// hour together: kept under the seventh of a window Better Auth's documented example slides at.
// Global, so persons' rows slide as often.
const SESSION_UPDATE_AGE_SECONDS = 5 * 60;

const CODE_VALIDITY_SECONDS = CODE_VALIDITY_MINUTES * 60;

const CODE_SIGN_IN_PATH = "/sign-in/email-otp";

/** What the code check takes: the browser's client sends these two, and a name or an image is a hand-made request's. */
const CODE_SIGN_IN_FIELDS: ReadonlySet<string> = new Set(["email", "otp"]);

const CODE_SEND_PATH = "/email-otp/send-verification-otp";

/** Mails a deletion link where called without a token; a press completes the link through `/delete-user/callback`. */
const DELETE_USER_PATH = "/delete-user";

/** The library's `deleteUser` answer to a mailed link, which a capped request answers too. */
const DELETION_LINK_SENT = "Verification email sent";

const PASSKEY_REGISTRATION_PATH = "/passkey/verify-registration";

// Both halves of an enrolment, which the plugin gates on `freshAge` and on nothing else -- so the
// hook below is the whole of what a code-borne session meets on either.
const ENROLMENT_PATHS: ReadonlySet<string> = new Set(["/passkey/generate-register-options", PASSKEY_REGISTRATION_PATH]);

// A field the plugin's schemas take and this league's client never sends: it titles the row on the
// surface built to spot a planted one. `createSession` stays open, so setting a passkey up signs in with it.
const ENROLMENT_FIELDS_REFUSED: readonly string[] = ["name"];

// The library answers each of these with the session row it minted, or its `token` -- the cookie's own
// value -- beside the user.
const SESSION_ANSWER_PATHS: ReadonlySet<string> = new Set([PASSKEY_REGISTRATION_PATH, PASSKEY_ASSERTION_PATH, CODE_SIGN_IN_PATH]);

/**
 * What every finished sign-in answers instead: the plugin's own shape for a call that carries no record back. The
 * passkey assertion adds the address it signed in.
 */
const SIGNED_IN = { status: true };

// Every endpoint that mints a session, with the factor it proves. A path missing here mints nothing,
// so one a release adds fails closed rather than handing out a session no guard has classified.
const SESSION_FACTOR_BY_PATH: ReadonlyMap<string, AuthFactor> = new Map([
  [PASSKEY_ASSERTION_PATH, PASSKEY_FACTOR],
  [PASSKEY_REGISTRATION_PATH, PASSKEY_FACTOR],
  [CODE_SIGN_IN_PATH, CODE_FACTOR],
]);

class SessionFromUnlistedPath extends Error {
  override name = "SessionFromUnlistedPath";
}

/** The assertion's options, the first of the two calls a passkey sign-in makes. */
const PASSKEY_ASSERTION_OPTIONS_PATH = "/passkey/generate-authenticate-options";

/**
 * The edge's trace off the request a sign-in arrived on, whose access line holds the address it came from: a sign-in
 * runs under no request scope of this application's, arriving through the library's own route.
 */
function signInTrace(ctx: GenericEndpointContext): string | undefined {
  return readTraceparent(new Headers(ctx.headers ?? ctx.request?.headers).get(TRACEPARENT_HEADER));
}

/** Whether a `/delete-user` body asks for a link, as the library reads it: any token it holds completes one instead. */
function asksForDeletionLink(body: unknown): boolean {
  const token: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "token") : undefined;
  return !token;
}

/** The address a code sign-in names, or `null` where the body carries none the library would read. */
function codeSignInAddress(body: unknown): string | null {
  const email: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "email") : undefined;
  return typeof email === "string" ? email : null;
}

/** The cookie a code's ask sets in the asking browser, named by the library as it names the session's. */
const CODE_ASKED_COOKIE = "code_asked";

/** The claim of that cookie's token naming the address it was asked for. */
const ASKED_CLAIM = "asked";

/**
 * The address a code was asked for, as the cookie carries it: keyed, since an address is guessable, and over the
 * cookie's own name ahead of it, since the counters' rows key the bare address with the session cookie's own
 * construction, and handing that digest to any browser that asks would sign posted text for whoever posts it.
 */
async function askedDigest(email: string, secret: string): Promise<string> {
  return makeSignature(`${CODE_ASKED_COOKIE}:${asSignInIdentifier(email)}`, secret);
}

/**
 * Whether the request carries the cookie of an ask for `address`, inside the code's lifetime. The token carries its
 * own expiry, since a value copied out of the browser outlives the cookie's: each round of tries costs a new ask,
 * which mails the address and spends its hour.
 */
async function askedHere(ctx: GenericEndpointContext, address: string | null): Promise<boolean> {
  const token = ctx.getCookie(ctx.context.createAuthCookie(CODE_ASKED_COOKIE).name);
  if (address === null || token === null) return false;

  // Read as what it is: claims a caller sent, which only the signature has checked.
  const claims = await verifyJWT<Partial<Record<typeof ASKED_CLAIM, unknown>>>(token, ctx.context.secret);
  return claims !== null && claims[ASKED_CLAIM] === (await askedDigest(address, ctx.context.secret));
}

// The library mounts far more endpoints than a browser here calls, and an upgrade adds more, so the
// surface is closed from two sides: the documented switch below, and the default-deny hook that also
// covers what it cannot. These are what a browser of this league calls: the two passkey ceremonies'
// four paths, the code check and the sign-out; the code's send and every guard run in process instead.
// The spellings come from the constants the stamp, the enrolment refusal, the assertion's ask and the code's
// bounds compare, so a release that renamed one would 404 the real call rather than let it through unjudged.
const BROWSER_PATHS: ReadonlySet<string> = new Set([
  ...ENROLMENT_PATHS,
  PASSKEY_ASSERTION_OPTIONS_PATH,
  PASSKEY_ASSERTION_PATH,
  CODE_SIGN_IN_PATH,
  // Ends the session the request's own cookie names and no other, so a cross-site post meets the library's origin check
  // and nothing more is at stake.
  "/sign-out",
]);

// The library's own switch, which refuses before a route is matched or a body read. It compares a
// path derived from the URL, so neither parameterised route can be named here at all and the hook is
// what refuses those two.
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
  "/sign-in/social",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

// Matched on the OPENING of the library's own message, because each of these ends in the value it
// rejected. The events are this repository's, so an upgrade that rewords one falls to the entry below
// rather than putting the reworded message on the stream.
const LIBRARY_EVENTS: readonly (readonly [string, string])[] = [
  ["Invalid origin", "auth.origin_refused"],
  ["Invalid callbackURL", "auth.callback_refused"],
  ["Invalid redirectURL", "auth.callback_refused"],
  ["Invalid errorCallbackURL", "auth.callback_refused"],
  ["Invalid newUserCallbackURL", "auth.callback_refused"],
  ["Blocked cross-site navigation login attempt", "auth.cross_site_login_blocked"],
  // The adapter's line for an abort after a failed commit that failed too, which leaves the transaction
  // open on the server.
  ["Failed to abort a MongoDB transaction", "auth.transaction_left_open"],
];

const LIBRARY_EVENT_UNKNOWN = "auth.library_failed";

/** The passkey plugin's line for a registration that failed past its verifier, which its error names. */
const REGISTRATION_FAILED = "Failed to verify registration";

const sessionOptions = {
  expiresIn: SESSION_EXPIRES_IN_SECONDS,
  updateAge: SESSION_UPDATE_AGE_SECONDS,
  // `passkeyStepOf` offers an administrator's enrolment on the same figure, so the page never offers what the library
  // refuses.
  freshAge: FRESH_SIGN_IN_SECONDS,
  // Off, so revocation stays a store read on every request and the guards judge a stored row rather than
  // a signed copy of one.
  cookieCache: { enabled: false },
  additionalFields: {
    // `input: false` is the whole defence for both: left writable, any holder of any session stamps
    // itself as passkey-verified, or names another passkey's sessions, through `POST /update-session`.
    authFactor: { type: "string", required: false, input: false },
    // The `credentialID` of the passkey that made the session, so removing that passkey ends its
    // sessions and no other.
    passkeyCredentialId: { type: "string", required: false, input: false },
    // Marked by the refresh alone (`input: false`, as above): a session clearing its own mark would undo
    // the administrator's idle window.
    adminLapsed: { type: "boolean", required: false, input: false },
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
  // Both halves run in process alone, `DISABLED_PATHS` refusing `/delete-user` and its callback over HTTP. Nothing
  // is mailed once it has deleted: this deletion is the person's own press, whose done page tells them it went, and
  // the deletion notice is for a deletion they did not press.
  deleteUser: {
    enabled: true,
    deleteTokenExpiresIn: ERASURE_LINK_VALID_HOURS * 60 * 60,
    sendDeleteAccountVerification: sendDeletionLink,
    beforeDelete: eraseBeforeTheAccount,
  },
} satisfies BetterAuthOptions["user"];

class DeletionWithoutErasure extends Error {
  override name = "DeletionWithoutErasure";
}

/**
 * One press of a mailed deletion link: whether the library has spent the link, which it does before this hook runs and
 * whatever the hook then answers.
 */
export type DeletionPress = { linkSpent: boolean };

/**
 * The press `deleteOwnAccount` runs the library's deletion under, for the deletion that call makes: the hook takes no
 * per-call value, so the press reaches it here.
 */
export const ownErasure = new AsyncLocalStorage<DeletionPress>();

/**
 * Runs after the library has spent the token and checked it against the signed-in user, and before it deletes
 * anything: an account never goes while the league's records of its address stand.
 */
async function eraseBeforeTheAccount(user: { id: string; email: string }): Promise<void> {
  const press = ownErasure.getStore();
  // First: whatever follows, the link this press carried is spent.
  if (press !== undefined) press.linkSpent = true;
  // The backend erases the request's person and the library deletes the session's user, so the two must
  // be one address; outside a press, no deletion goes ahead at all.
  const actor = getRequestActor();
  if (press === undefined || actor?.lane !== "person" || actor.email !== asSignInIdentifier(user.email)) throw new DeletionWithoutErasure();

  // Thrown on as it came, for the press to word: the account and its passkeys stand, the link spent.
  await identityPostAccountErasure();

  // Before the library deletes the user row: a failure past here leaves that row for the account sweep,
  // never passkeys whose account is gone.
  const { adapter, secret } = await auth.$context;
  await deleteSignInRowsOf(adapter, secret, user.email, user.id);
}

/**
 * Host-bound over https. Through the prefix and never a cookie name: the
 * library puts `__Secure-` ahead of any name while `useSecureCookies` is on, and a `__Secure-__Host-` cookie
 * is bound to no host.
 */
const cookieNaming = (origin: URL): { useSecureCookies?: false; cookiePrefix?: string } =>
  origin.protocol === "https:" ? { useSecureCookies: false, cookiePrefix: `__Host-${MONGO_DB_NAME}` } : {};

/**
 * The session cookie the request carries, read as the library names it and never validated: the proxy's
 * optimistic check, which reads no store and slides nothing.
 */
export function sessionCookieOf(requestHeaders: Headers): string | null {
  // The library reads a `__Secure-` spelling of the name ahead of the name, which a sibling subdomain can plant where it
  // cannot plant a `__Host-` one. This origin writes none, `useSecureCookies` being off, so none is read.
  const ownCookies = (requestHeaders.get("cookie") ?? "")
    .split(";")
    .filter((pair) => !pair.trimStart().startsWith(SECURE_COOKIE_PREFIX))
    .join(";");

  return getSessionCookie(new Headers({ cookie: ownCookies }), { cookiePrefix: cookieNaming(new URL(frontend_config.AUTH_URL)).cookiePrefix });
}

// `origin` gives both halves of the WebAuthn binding.
const authOptions = (origin: URL, client: MongoClient) =>
  ({
    // The `Db` off the one client this process opens, never a second connection.
    database: mongodbAdapter(client.db(MONGO_DB_NAME), { client }),

    // Passed rather than left to the environment: the library reads no bare `AUTH_URL`, and this
    // value's origin also decides the `__Host-` cookie prefix below and the passkey relying-party id.
    baseURL: frontend_config.AUTH_URL,
    secret: authSecret(),

    session: sessionOptions,
    user: userOptions,

    advanced: {
      // The session and its user in one `$lookup` rather than a second query: every guard reads the
      // session on every request, cookie caching being off above.
      database: { joins: true },
      // Left to its default, the library would store the caller's address on every session row, which
      // nothing here would read, the limiter that would being off. The edge's own access line already
      // carries the address, under its retention bound.
      ipAddress: { disableIpTracking: true },
      // The library turns its origin check, and the CSRF checks riding on it, off wherever `NODE_ENV` is
      // `test` or `TEST` is set, so the check is pinned on whatever the environment says.
      disableOriginCheck: false,
      ...cookieNaming(origin),
    },

    // Never "hashed": the hook below matches a code row by its plain prefix, and each bound writes through
    // the library but counts through the raw adapter, so hashing would stamp no code and count nothing.
    verification: { storeIdentifier: "plain" },

    databaseHooks: {
      verification: {
        create: {
          // A wrong guess writes its code back stamped now, and the plugin takes the newest stamp for the
          // live code, so a send racing the guess would lose to it: stamped with its issue time instead.
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
          // them. This stamps; the guards decide.
          before: async (session, ctx) => {
            // Absent on a mint no endpoint made, which is no sign-in this league offers. Tested for
            // falsiness: the library hands `undefined` there, whatever its type says.
            const factor = ctx ? SESSION_FACTOR_BY_PATH.get(ctx.path) : undefined;
            if (!ctx || factor === undefined) throw new SessionFromUnlistedPath();

            // Here, where every sign-in passes -- a code, a passkey, a set-up that signs in, a passkey touch --
            // and never at one method's own callback, which the next method would walk past.
            const admittedAsOf = await refuseUnadmitted(ctx, session.userId);

            const credential = factor === PASSKEY_FACTOR ? { passkeyCredentialId: ceremonyCredentialId(ctx) } : {};
            const replaced = await replacedToken(ctx);
            const lineage = replaced === null ? {} : { [REPLACED_SESSION_FIELD]: await lineageOf(replaced, ctx.context.secret) };

            // Stamped again past every await, so the order of two mints is their order of insert, one write
            // apart, and not of a backend round trip: `endEarlierSiblings` keeps the latest by it.
            const stamped = now();
            const lifetime = new Date(session.expiresAt).getTime() - new Date(session.createdAt).getTime();

            return {
              data: {
                ...session,
                // As of the gate read, never its insert: a ban committing between the two ends the
                // account's sessions before this row exists, and dated past it the row outlives the lift.
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
            // Every factor's sign-in passes here, and the line names the account by its id alone, never its address.
            logger.info("auth.signed_in", {
              user_id: session.userId,
              factor: SESSION_FACTOR_BY_PATH.get(ctx.path),
              trace_id: signInTrace(ctx),
            });
          },
        },
        update: {
          // The refresh moves `updatedAt` to now, erasing the idle gap every later read judges: the row as
          // read before this write is judged instead, so a session the administrator's window refused stays
          // refused.
          before: async (data, ctx) => {
            // Only a write moving `updatedAt` erases the gap; any other leaves the stamp to judge by.
            if (data.updatedAt === undefined) return;
            const prior = ctx?.context.session?.session;
            // No row to judge is no window kept, as `withinLifetime` reads an unreadable stamp.
            if (prior !== undefined && withinLifetime(prior, ADMIN_LIFETIME)) return;
            return { data: { ...data, adminLapsed: true } };
          },
        },
      },
    },

    // Off everywhere: the edge meters these paths per network, the code check on a tighter budget, and
    // the library's own rules key on a network address it does not store and reach no in-process call;
    // `withinBound` stands in for them per address.
    rateLimit: { enabled: false },

    disabledPaths: [...DISABLED_PATHS],

    // Shaped rather than left to the library's default, which prints whole error objects and a
    // rejected `callbackURL` or `origin` VALUE, both of them submitted.
    logger: {
      // Below this the library has only static boot notes, and a line this handler may not quote is
      // a line with nothing in it.
      level: "error",
      log: (_level, message, ...args: unknown[]) => {
        // Matched to an event of this repository's own and never forwarded, because the library
        // interpolates the rejected value into the message itself.
        const event = LIBRARY_EVENTS.find(([opening]) => message.startsWith(opening))?.[1] ?? LIBRARY_EVENT_UNKNOWN;

        // `args` is dropped whole: it carries the error object itself, which the logger writes with its
        // message and stack. The error's name is all the line keeps, so an error this league throws inside
        // the library is a class naming itself.
        const raised = args.find((argument) => argument instanceof Error);

        // A second row for a credential the index holds: one authenticator enrolled twice at once, or a credential
        // another account holds. Set-ups of one authenticator at once conflict in a transaction whose retry meets it.
        if (message.startsWith(REGISTRATION_FAILED) && isDuplicateCredential(raised)) {
          logger.warn("auth.passkey_enrolment_conflict");
          return;
        }

        logger.error(event, undefined, { name: raised?.name ?? "unknown" });
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // First, ahead of every count and every session read below: an arrival over HTTP at a path the browser never
        // calls writes no row before it is refused. The switch above is a denylist, so an endpoint the next upgrade
        // mounts arrives open; this is the default-deny net behind it, over `ctx.path`, the endpoint's own declared
        // route rather than a string derived from the URL a caller sent. An absent `ctx.request` is the library's own
        // test for a call that did not arrive over HTTP, taken by `originCheckMiddleware` and by
        // `requestOnlySessionMiddleware`; nothing in process is filtered, those callers being this repository's own code.
        if (ctx.request !== undefined && !BROWSER_PATHS.has(ctx.path)) throw APIError.fromStatus("NOT_FOUND");

        // The library types a request's body `any`: read here as what it is, a value nothing has checked yet.
        const body: unknown = ctx.body;
        // Refused ahead of the count, and rather than dropped, as an enrolment's `name` is: the library
        // writes a name and an image it is handed onto a first sign-in's account.
        if (ctx.path === CODE_SIGN_IN_PATH && typeof body === "object" && body !== null) {
          if (Object.keys(body).some((field) => !CODE_SIGN_IN_FIELDS.has(field))) throw APIError.fromStatus("BAD_REQUEST");
        }
        // Over HTTP, ahead of the count: a code is checked only in the browser that asked for its address, so a
        // stranger's guesses spend an address's day only after asking for its code, which mails the person. In
        // process there is no browser, every caller being this
        // repository's own code, as the deny above reads it.
        if (ctx.path === CODE_SIGN_IN_PATH && ctx.request !== undefined && !(await askedHere(ctx, codeSignInAddress(body)))) {
          logger.info("auth.code_not_asked_here", { trace_id: signInTrace(ctx) });
          throw new APIError("BAD_REQUEST", { code: CODE_NOT_ASKED_HERE, message: "No code was asked for this address in this browser." });
        }
        // On both arms, ahead of the in-process return below. Counted whatever the address holds: a
        // lock only members met would be a membership oracle.
        const address = ctx.path === CODE_SIGN_IN_PATH ? codeSignInAddress(body) : null;
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
          if (typeof body === "object" && body !== null) attemptRows.set(body, own);
        }

        // Ahead of the library, which mints the token row before its sender runs: capped, nothing is minted or
        // mailed and the answer reads as mailed. No session is the library's to refuse.
        if (ctx.path === DELETE_USER_PATH && asksForDeletionLink(body)) {
          const asking = await getSessionFromCtx(ctx);
          if (asking !== null && (await deletionLinkCapped(ctx.context, asking.user.email))) {
            return ctx.json({ success: true, message: DELETION_LINK_SENT });
          }
        }

        // Both arms: an in-process assertion answered by another account's passkey is no less that account's.
        if (ctx.path === PASSKEY_ASSERTION_PATH) await refuseAnotherAccountsPasskey(ctx);

        if (!ENROLMENT_PATHS.has(ctx.path)) return undefined;

        // The one judgement of an enrolment, on both arms, an `auth.api` call among them: the plugin gates its two
        // registration endpoints on its `freshAge` alone, and `registration.afterVerification` judges nothing but the
        // posted id. A second judgement there would read the same session, the same gate answer and the same rows a
        // moment later, closing no race the hook leaves open, a transaction around it included: two enrolments of
        // different authenticators at once may both stand, and one authenticator's twice meets the unique index.

        // Refused rather than dropped: a caller who read the plugin's own body schema is answered,
        // and a request reshaped behind its back is how the next reader believes the field works.
        for (const field of ENROLMENT_FIELDS_REFUSED) {
          if (typeof body === "object" && body !== null && field in body) throw APIError.fromStatus("BAD_REQUEST");
          // The options half takes `name` on the query string instead, where it becomes the account
          // name the browser's own prompt shows.
          if (Reflect.get(ctx.query ?? {}, field) !== undefined) throw APIError.fromStatus("BAD_REQUEST");
        }

        const caller = await getSessionFromCtx(ctx);

        // Refused rather than left to the plugin's `freshSessionMiddleware`, which is mounted only
        // while `registration.requireSession` keeps its default: this judges nothing about a session
        // it cannot read.
        if (caller === null || endedByItsAccount(caller)) throw APIError.fromStatus("NOT_FOUND");

        // Taken before the read is sent: the session a set-up mints is dated by it.
        const sentAt = now();
        const signIn = await enrolmentSignIn(caller.user.email);
        refuseBarred(signIn);
        refuseWithoutGrant(signIn);

        const verifying = ctx.path === PASSKEY_REGISTRATION_PATH;
        // The options request is judged now; the verify call as of its ceremony's options, read here before the plugin
        // spends the challenge, or now where none stands.
        await refuseEnrolment(
          ctx.context.adapter,
          caller.user.id,
          stampsOf(caller.session),
          verifying ? ((await challengeIssuedAt(ctx)) ?? undefined) : undefined,
        );

        // Carried on the endpoint's context into the registration's transaction, where the mint asks the gate again
        // of this read: a backend round trip inside it would hold it open.
        const carried: EnrolmentRead = { userId: caller.user.id, signIn, sentAt };
        return verifying ? { context: { [ENROLMENT_READ]: carried } } : undefined;
      }),

      // The `Set-Cookie` the endpoint wrote is untouched: `runAfterHooks` merges this hook's own
      // headers into the response's rather than replacing them, so the credential still travels.
      after: createAuthMiddleware(async (ctx) => {
        const body: unknown = ctx.body;
        // Logged and left on a failure: by now the rotation has ended the browser's old session, so a
        // throw here would answer a right code with a 500 and no cookie.
        if (ctx.path === CODE_SIGN_IN_PATH && typeof body === "object" && body !== null) {
          const own = attemptRows.get(body);
          await unlessUnsettled(() => settleCodeAttempt(ctx.context, own, ctx.context.returned));
          // The code refused, never a mint refusing past a right one, and by trace alone: the address stays off the line.
          if (isAPIError(ctx.context.returned) && !refusedAtMint(ctx.context.returned)) {
            logger.info("auth.code_refused", { trace_id: signInTrace(ctx) });
          }
        }

        if (!SESSION_ANSWER_PATHS.has(ctx.path)) return undefined;

        // Left standing where the sign-in was refused, or a refusal is answered as a success.
        if (isAPIError(ctx.context.returned)) return undefined;

        // Here rather than in the callback above, which runs BEFORE the write: a notice sent there
        // would name an enrolment a later refusal never made.
        if (ctx.path === PASSKEY_REGISTRATION_PATH) {
          const enrolled = await getSessionFromCtx(ctx);
          if (enrolled !== null) await notifyPasskey("passkey_added", enrolled.user.email);
        }

        // The touch reads whom the assertion signed in, to refuse another account's passkey before the act it guards; the
        // documented `newSession` names that account, and the answer carries its address alone, never the row's token.
        const signedIn = ctx.context.newSession;
        if (ctx.path === PASSKEY_ASSERTION_PATH && signedIn !== null) return ctx.json(assertionAnswer(signedIn.user.email));

        // Neither the pages nor the passkey plugin's client read anything off these bodies but whether
        // one is there.
        return ctx.json(SIGNED_IN);
      }),
    },

    plugins: [
      // `disableSignUp` stays off: every person's row is written at their first verification, so set
      // it the first correct code dies, and the gate below is the only barrier.
      // A code row for EVERY address typed, and the send below handed each one, so a verify reads alike
      // for a member and a stranger and the gate decides only the mail.
      emailOTP({
        otpLength: SIGN_IN_CODE_LENGTH,
        expiresIn: CODE_VALIDITY_SECONDS,
        allowedAttempts: CODE_ATTEMPTS,
        // Encrypted under the secret rather than hashed: an unkeyed hash of six digits is undone by
        // trying all million of them.
        storeOTP: "encrypted",
        // Every send mints a new code, valid ten minutes from its own mail, and voids the one before.
        // "reuse" moves a live code's expiry on every send, so a code asked for again every few minutes
        // never lapses.
        resendStrategy: "rotate",
        async sendVerificationOTP({ email, otp, type }) {
          // The one type this application asks for: every endpoint minting another is refused over
          // HTTP and never called in process.
          if (type !== "sign-in") return;

          // The refusal, whole: an address the gate refuses, for whatever reason, is mailed nothing
          // and this returns as though it had, so every branch is one answer.
          if ((await mayReceiveSignIn(email)) !== "admitted") return;

          // Awaited: the sign-in action, the one caller a stranger reaches, runs this whole send behind its
          // response, and the library's own send route is closed.
          try {
            await oweSignInMail(email, { kind: "sign_in_code" }, { value: otp, validMs: CODE_VALIDITY_SECONDS * 1000 });
          } catch (failed) {
            // Name only: a failure on this path routinely carries the submitted address, and the logger
            // writes its message and stack, scrubbing the address alone.
            logger.error("auth.code_send_failed", undefined, {
              name: failed instanceof Error ? failed.name : "unknown",
            });
          }
        },
      }),

      passkey({
        // What the browser's own passkey prompt shows, where the plugin's default names the library
        // rather than this league.
        rpName: COPY.brand.name,
        // Named rather than left to the plugin's own derivation, which answers this same host off
        // `baseURL`: what an enrolled passkey is bound to for life outlives that option.
        rpID: origin.hostname,
        // Unset, this is the caller's own `Origin` header -- a ceremony checked against the value its
        // own sender chose.
        origin: origin.origin,
        // The user verification is the whole of that requirement: the plugin asks it in both ceremonies'
        // options and refuses a response whose authenticator did not verify the user, before anything is
        // written. Set to "preferred" and both halves relax together, which is what WebAuthn Level 3 §7.2
        // conditions the check on.
        authenticatorSelection: { userVerification: "required", residentKey: "required" },
        // The callback runs before the plugin writes the passkey row, so a refusal here leaves the store
        // as it found it. The enrolment itself is judged in the before hook, once.
        registration: {
          afterVerification: async ({ ctx, verification }) => {
            // The verifier holds the posted `id` to `rawId` and neither to the attested credential, so
            // a session this enrolment mints would otherwise name whichever passkey its caller chose.
            if (declaredCredentialId(ctx) !== verification.registrationInfo?.credential.id) throw APIError.fromStatus("BAD_REQUEST");
          },
        },
      }),

      // No `customSession`: it reshapes `/get-session`, which `DISABLED_PATHS` closes to every browser, so
      // `readLibrarySession` would be its one reader, and `projected` already builds that reader's copy over
      // the library's own read.

      // Last, which the library warns about: it copies a response's `set-cookie` into Next's store.
      nextCookies(),
    ],
  }) satisfies BetterAuthOptions;

const build = () => betterAuth(authOptions(new URL(frontend_config.AUTH_URL), signInStore()));

let built: ReturnType<typeof build> | undefined;

/**
 * Built on first use rather than at import: `next build` loads this module in every page-data worker holding no
 * environment, where neither the URL nor the client can be built and constructing the library starts a check that
 * rejects with nobody awaiting it. Its options and context both carry the session key: the library's own route handler
 * and the modules beside this one import it, and every other module calls a narrow function one of them exports.
 */
export const auth = new Proxy({} as ReturnType<typeof build>, {
  // `Reflect.get` answers `any`: the proxy's own type, the instance's, is what every caller reads.
  get: (_, key): unknown => Reflect.get((built ??= build()), key),
  // `toNextJsHandler` asks `"handler" in auth` on every request.
  has: (_, key) => Reflect.has((built ??= build()), key),
});

export const sendSignInCode = (email: string, requestHeaders: Headers) =>
  auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: requestHeaders });

/**
 * Whether a sign-in code asked for `email` would be its address's sixth mail of the hour, this ask counted whatever
 * the address holds. Asked ahead of the gate, so the store's rows never tell a member from a stranger, and on the rows
 * the deletion link counts on, so the two mails a visitor can ask for share one bound. A store that cannot count
 * throws.
 */
export async function codeMailCapped(email: string): Promise<boolean> {
  const context = await auth.$context;
  const perAddress = await boundIdentifier(MAIL_ROW_PREFIX, email, context.secret);
  if ((await withinBound(context, perAddress, CODE_MAIL_LIMIT, CODE_MAIL_WINDOW_HOURS * HOUR_MS)) !== null) return false;

  logger.info("auth.code_mail_capped");
  return true;
}

/**
 * The cookie the sign-in action sets on every ask for a code, which the code check reads: a token naming the address,
 * living as long as the code it asked for, and nothing the gate decided, so a member's and a stranger's are alike.
 * `Lax` and host-bound as the session's: a post from another site carries none.
 */
export async function codeAskedCookie(email: string) {
  const { createAuthCookie, secret } = await auth.$context;
  const { name } = createAuthCookie(CODE_ASKED_COOKIE);
  const value = await signJWT({ [ASKED_CLAIM]: await askedDigest(email, secret) }, secret, CODE_VALIDITY_SECONDS);

  return {
    name,
    value,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // Spelled out: the library's own setter adds it to a `__Host-` name, which a browser drops without it, and Next's
      // does not.
      secure: new URL(frontend_config.AUTH_URL).protocol === "https:",
      maxAge: CODE_VALIDITY_SECONDS,
    },
  } as const;
}
