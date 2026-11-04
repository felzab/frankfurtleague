import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth, getCurrentAdapter } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { getSessionCookie, SECURE_COOKIE_PREFIX } from "better-auth/cookies";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";

import { CODE_VALIDITY_MINUTES } from "../authEmail";
import { MONGO_DB_NAME } from "../authIndexes";
import { now } from "../clock";
import { authSecret, frontend_config } from "../config";
import { signInStore } from "../db";
import { asSignInIdentifier } from "../emailAddress";
import { BRAND_NAME } from "../emailShell";
import { ERASURE_LINK_VALID_HOURS } from "../loeschungEmail";
import { logger } from "../logging";
import { declaredCredentialId, PASSKEY_ASSERTION_PATH } from "../passkeyCeremony";
import { passkeyLastUse } from "../passkeyLastUse";
import { USER_VERIFICATION_REFUSED } from "../passkeyRefusal";
import { getRequestActor } from "../requestScope";
import { ADMIN_LIFETIME, SESSION_EXPIRES_IN_DAYS } from "../sessionLifetimes";
import { CODE_FAILURE_LIMIT, CODE_FAILURE_WINDOW_HOURS, CODE_MAIL_LIMIT, CODE_MAIL_WINDOW_HOURS, SIGN_IN_CODE_LENGTH } from "../signInCode";
import { mayReceiveSignIn } from "../signInGate";
import { HOUR_MS } from "../timeUnits";
import { readTraceparent, TRACEPARENT_HEADER } from "../trace";
import { assertionAnswer } from "./assertionAnswer";
import { ceremonyCredentialId, challengeIssuedAt, isDuplicateCredential, refuseAnotherAccountsPasskey } from "./ceremony";
import { ADDRESS_ATTEMPTS_EXHAUSTED } from "./codeRefusal";
import { carriedEnrolmentRead, carriedOrRefuse, ENROLMENT_READ, refuseBarred, refuseEnrolment } from "./enrolment";
import { enrolmentSignIn } from "./gateReads";
import { notifyPasskey, oweSignInMail, sendDeletionLink } from "./mails";
import { endReplacedSession, lineageOf, refuseUnadmitted, replacedToken } from "./minting";
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

/** The one path that spends a code, which the browser's client posts (`fl_frontend/src/core/authClient.ts`). */
const CODE_SIGN_IN_PATH = "/sign-in/email-otp";

/** What the code check takes: the browser's client sends these two, and a name or an image is a hand-made request's. */
const CODE_SIGN_IN_FIELDS: ReadonlySet<string> = new Set(["email", "otp"]);

/** The one path that mails a code, which `fl_frontend/src/features/auth/actions.ts :: handleSignIn` calls in process. */
const CODE_SEND_PATH = "/email-otp/send-verification-otp";

/**
 * The one path that mails a deletion link, called in process without a token; a press completes the link through
 * `/delete-user/callback`, also called in process (`fl_frontend/src/core/auth/accounts.ts :: deleteOwnAccount`).
 */
const DELETE_USER_PATH = "/delete-user";

/** The library's answer to a mailed link, which a capped request answers too (`better-auth/api :: deleteUser`). */
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
 * passkey assertion adds the address it signed in (`./assertionAnswer.ts`).
 */
const SIGNED_IN = { status: true };

// Every endpoint that mints a session, with the factor it proves. A path missing here mints nothing,
// so one a release adds fails closed rather than handing out a session no guard has classified.
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
// paths, its code check and its sign-out. The code's send and every guard run in process instead.

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
  "/sign-in/social",
  "/sign-up/email",
  "/unlink-account",
  "/update-session",
  "/update-user",
  "/verify-email",
  "/verify-password",
];

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
  // The adapter's line for an abort after a failed commit that failed too, which leaves the transaction
  // open on the server (`@better-auth/mongo-adapter :: abortTransactionCommand`).
  ["Failed to abort a MongoDB transaction", "auth.transaction_left_open"],
];

const LIBRARY_EVENT_UNKNOWN = "auth.library_failed";

/** The passkey plugin's line for a registration that failed past its verifier, which its error names. */
const REGISTRATION_FAILED = "Failed to verify registration";

const sessionOptions = {
  expiresIn: SESSION_EXPIRES_IN_SECONDS,
  updateAge: SESSION_UPDATE_AGE_SECONDS,
  // `passkeyStepOf` offers an enrolment on the same figure, so the page never offers what the library refuses.
  freshAge: FRESH_SIGN_IN_SECONDS,
  // Off, so revocation stays a store read on every request and the guards (`fl_frontend/src/core/auth/guards.ts`)
  // judge a stored row rather than a signed copy of one.
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
  // Both halves run in process alone, `DISABLED_PATHS` refusing `/delete-user` and its callback over HTTP.
  deleteUser: {
    enabled: true,
    deleteTokenExpiresIn: ERASURE_LINK_VALID_HOURS * 60 * 60,
    sendDeleteAccountVerification: sendDeletionLink,
    beforeDelete: eraseBeforeTheAccount,
  },
} satisfies BetterAuthOptions["user"];

/** Named, because the library's failure line records an error's name and nothing else. */
class DeletionWithoutErasure extends Error {
  override name = "DeletionWithoutErasure";
}

// Our own dependency injection, never a compensation for the library: the hook takes no per-call
// value, the backend's write lives in a slice's mutations module, and `core` imports no slice.
/**
 * One press of a mailed deletion link: the erasure of the league's records it hands `deleteOwnAccount`, and whether
 * the library has spent the link, which it does before this hook runs and whatever the hook then answers.
 */
export type DeletionPress = { readonly erase: () => Promise<unknown>; linkSpent: boolean };

/** The press `deleteOwnAccount` runs the library's deletion under, for the deletion that call makes. */
export const ownErasure = new AsyncLocalStorage<DeletionPress>();

/**
 * Runs after the library has spent the token and checked it against the signed-in user, and before it deletes
 * anything: an account never goes while the league's records of its address stand.
 */
async function eraseBeforeTheAccount(user: { id: string; email: string }): Promise<void> {
  const press = ownErasure.getStore();
  // First: whatever follows, the link this press carried is spent (`better-auth/api :: deleteUserCallback`).
  if (press !== undefined) press.linkSpent = true;
  // The backend erases the request's person and the library deletes the session's user, so the two must
  // be one address; with no erasure handed in, no deletion goes ahead at all.
  const actor = getRequestActor();
  if (press === undefined || actor?.lane !== "person" || actor.email !== asSignInIdentifier(user.email)) throw new DeletionWithoutErasure();

  // Thrown on as it came, for the press to word: the account and its passkeys stand, the link spent.
  await press.erase();

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

// Called by `build`, never at import: `next build` imports this module in every page-data worker
// holding no environment, where neither the URL nor the client can be built.
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

    // Left to its default, the library would store the caller's address on every session row; the switch
    // below stores none, and nothing here would read one, the limiter that would being off.

    advanced: {
      // The session and its user in one `$lookup` rather than a second query: every guard reads the
      // session on every request, cookie caching being off above.
      database: { joins: true },
      // The edge's own access line already carries the address, under a bound (`docs/datenschutz.md` §6).
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

            // Here, where every sign-in passes -- a code, a passkey, a set-up that signs in, a step-up --
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

    // Off everywhere: the edge meters these paths, the code check's on the confirmation zones
    // (`nginx/shared/site.conf`), and the library's own rules key on a network address it does not store
    // and reach no in-process call; `withinBound` stands in for them per address.
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

        // `args` is dropped whole: it carries the error object itself, which
        // `fl_frontend/src/core/logging.ts` writes with its message and stack.
        const raised = args.find((argument) => argument instanceof Error);

        // A second row for a credential the index holds: one authenticator enrolled twice at once without signing in, or
        // a credential another account holds. Set-ups of one authenticator at once conflict in a transaction retried to a 404.
        if (message.startsWith(REGISTRATION_FAILED) && isDuplicateCredential(raised)) {
          logger.warn("auth.passkey_enrolment_conflict");
          return;
        }

        logger.error(event, undefined, { name: raised?.name ?? "unknown" });
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // The library types a request's body `any`: read here as what it is, a value nothing has checked yet.
        const body: unknown = ctx.body;
        // Refused ahead of the count, and rather than dropped, as an enrolment's `name` is: the library
        // writes a name and an image it is handed onto a first sign-in's account.
        if (ctx.path === CODE_SIGN_IN_PATH && typeof body === "object" && body !== null) {
          if (Object.keys(body).some((field) => !CODE_SIGN_IN_FIELDS.has(field))) throw APIError.fromStatus("BAD_REQUEST");
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

        // Ahead of the plugin, which writes each new code before its send callback runs: capped there,
        // a send voids the held code and mails none. Ahead of the gate, so the store's rows never tell a
        // member from a stranger.
        const recipient = ctx.path === CODE_SEND_PATH ? codeSendAddress(body) : null;

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

        // Ahead of the library, which mints the token row before its sender runs: capped, nothing is minted or
        // mailed and the answer reads as mailed, as a capped code send's does. No session is the library's to refuse.
        if (ctx.path === DELETE_USER_PATH && asksForDeletionLink(body)) {
          const asking = await getSessionFromCtx(ctx);
          if (asking !== null && (await deletionLinkCapped(ctx.context, asking.user.email))) {
            return ctx.json({ success: true, message: DELETION_LINK_SENT });
          }
        }

        // Both arms: an in-process assertion answered by another account's passkey is no less that account's.
        if (ctx.path === PASSKEY_ASSERTION_PATH) await refuseAnotherAccountsPasskey(ctx);

        // Above the in-process return, so both arms carry it: the registration's transaction opens later,
        // and a backend round trip inside it would hold it open.
        const enrolling = ctx.path === PASSKEY_REGISTRATION_PATH ? await getSessionFromCtx(ctx) : null;
        // Taken before the read is sent: the session a set-up mints is dated by it.
        const sentAt = now();
        const enrolmentRead: EnrolmentRead | undefined =
          enrolling === null
            ? undefined
            : {
                userId: enrolling.user.id,
                signIn: await enrolmentSignIn(enrolling.user.email),
                sentAt: sentAt,
                // Here, before the plugin spends the challenge the verify call reads.
                challengeIssuedAt: await challengeIssuedAt(ctx),
              };
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
        for (const field of ENROLMENT_FIELDS_REFUSED) {
          if (typeof body === "object" && body !== null && field in body) throw APIError.fromStatus("BAD_REQUEST");
          // The options half takes `name` on the query string instead, where it becomes the account
          // name the browser's own prompt shows.
          if (Reflect.get(ctx.query ?? {}, field) !== undefined) throw APIError.fromStatus("BAD_REQUEST");
        }

        const caller = enrolling ?? (await getSessionFromCtx(ctx));

        // Refused rather than left to the plugin's `freshSessionMiddleware`, which is mounted only
        // while `registration.requireSession` keeps its default: this arm judges nothing about a
        // session it cannot read, and the in-process arm already refuses one.
        if (caller === null || endedByItsAccount(caller)) throw APIError.fromStatus("NOT_FOUND");

        refuseBarred(enrolmentRead?.signIn ?? (await enrolmentSignIn(caller.user.email)));
        // The options request is judged now; the verify call as of its ceremony's options, or now where none stands.
        await refuseEnrolment(ctx.context.adapter, caller.user.id, stampsOf(caller.session), enrolmentRead?.challengeIssuedAt ?? undefined);

        return carried;
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

        const offered: unknown = ctx.context.returned;
        if (ctx.path === PASSKEY_ASSERTION_OPTIONS_PATH && !isAPIError(offered) && typeof offered === "object" && offered !== null) {
          return ctx.json({ ...offered, userVerification: USER_VERIFICATION });
        }

        if (!SESSION_ANSWER_PATHS.has(ctx.path)) return undefined;

        // Left standing where the sign-in was refused, or a refusal is answered as a success.
        if (isAPIError(ctx.context.returned)) return undefined;

        // Here rather than in the callback above, which runs BEFORE the write: a notice sent there
        // would name an enrolment a later refusal never made.
        if (ctx.path === PASSKEY_REGISTRATION_PATH) {
          const enrolled = await getSessionFromCtx(ctx);
          if (enrolled !== null) await notifyPasskey("passkey_hinzugefuegt", enrolled.user.email);
        }

        // The touch reads whom the assertion signed in, to refuse another account's passkey before the act it guards; the
        // documented `newSession` names that account, and the answer carries its address alone, never the row's token.
        const signedIn = ctx.context.newSession;
        if (ctx.path === PASSKEY_ASSERTION_PATH && signedIn !== null) return ctx.json(assertionAnswer(signedIn.user.email));

        // The pages read nothing else off any of these bodies but whether it is there
        // (`@better-auth/passkey/client :: getPasskeyActions`, `fl_frontend/src/features/auth/components/forms/SignInFlow.tsx`).
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
        allowedAttempts: 3,
        // Encrypted under the secret rather than hashed: an unkeyed hash of six digits is undone by
        // trying all million of them.
        storeOTP: "encrypted",
        // Every send mints a new code, valid ten minutes from its own mail, and voids the one before.
        // "reuse" moved a live code's expiry on every send, so a code asked for again every few minutes
        // never lapsed.
        resendStrategy: "rotate",
        async sendVerificationOTP({ email, otp, type }) {
          // The one type this application asks for: every endpoint minting another is refused over
          // HTTP and never called in process.
          if (type !== "sign-in") return;

          // The refusal, whole: an address the gate refuses, for whatever reason, is mailed nothing
          // and this returns as though it had, so every branch is one answer.
          if ((await mayReceiveSignIn(email)) !== "admitted") return;

          // Awaited: the one caller a stranger reaches, `fl_frontend/src/features/auth/actions.ts :: handleSignIn`,
          // runs this whole send behind its response, and the library's own send route is closed (`DISABLED_PATHS`).
          try {
            await oweSignInMail(email, { art: "sign_in_code" }, { wert: otp, gueltigMs: CODE_VALIDITY_SECONDS * 1000 });
          } catch (failed) {
            // Name only: a failure on this path routinely carries the submitted address, and
            // `fl_frontend/src/core/logging.ts` writes its message and stack, an address alone scrubbed.
            logger.error("auth.code_send_failed", undefined, {
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
            // stand.
            const adapter = await getCurrentAdapter(ctx.context.adapter);

            // Judged again here, the last point before the row is written, and reached by an `auth.api`
            // call the hook lets through; off the hook's carried read, and nothing where it carried none.

            // `ctx.context.session` is put there by the plugin's own `freshSessionMiddleware`, which it
            // mounts only while `registration.requireSession` keeps its default: unset it and this arm
            // sees no factor at all and refuses every enrolment.
            const enrolling = ctx.context.session ?? null;
            if (enrolling !== null) refuseBarred(carriedOrRefuse(ctx, enrolling.user.id));
            await refuseEnrolment(
              adapter,
              user.id,
              enrolling === null ? null : stampsOf(enrolling.session),
              // As of the ceremony's options, as the hook judged it, the challenge being spent by now.
              (enrolling === null ? undefined : carriedEnrolmentRead(ctx, enrolling.user.id)?.challengeIssuedAt) ?? undefined,
              verification.registrationInfo?.credential.id,
            );
          },
        },
        authentication: { afterVerification: ({ verification }) => refuseUnverified(verification.authenticationInfo.userVerified) },
      }),

      passkeyLastUse(),

      // No `customSession`: it reshapes `/get-session`, which `DISABLED_PATHS` closes to every browser, so
      // `readLibrarySession` would be its one reader, and `fl_frontend/src/core/auth/session.ts :: projected` already
      // builds that reader's copy over the library's own read.

      // Last, which the library warns about: it copies a response's `set-cookie` into Next's store.
      nextCookies(),
    ],
  }) satisfies BetterAuthOptions;

const build = () => betterAuth(authOptions(new URL(frontend_config.AUTH_URL), signInStore()));

let built: ReturnType<typeof build> | undefined;

// Built on first use rather than at import: `next build` loads this module in every page-data worker with the secret
// undefined, and constructing the library starts a check that rejects there with nobody
// awaiting it.
/**
 * The library's instance, whose options and context both carry the session key: the library's own route
 * handler and the modules beside this one import it, and every other module calls a narrow function one of them exports.
 */
export const auth = new Proxy({} as ReturnType<typeof build>, {
  // `Reflect.get` answers `any`: the proxy's own type, the instance's, is what every caller reads.
  get: (_, key): unknown => Reflect.get((built ??= build()), key),
  // `toNextJsHandler` asks `"handler" in auth` on every request.
  has: (_, key) => Reflect.has((built ??= build()), key),
});

export const sendSignInCode = (email: string, requestHeaders: Headers) =>
  auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: requestHeaders });
