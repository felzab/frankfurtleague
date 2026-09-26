import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth, getCurrentAdapter } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { customSession } from "better-auth/plugins/custom-session";
import { magicLink } from "better-auth/plugins/magic-link";
import { MongoServerError } from "mongodb";

import { isUserAdmin } from "./allowlist";
import { buildAnmeldeLink } from "./anmeldeLink";
import { ANMELDUNG_LINK, ANMELDUNG_TAG } from "./anmeldeTag";
import { buildMagicLinkEmail, LINK_VALIDITY_MINUTES } from "./authEmail";
import { frontend_config } from "./config";
import { client } from "./db";
import { asSignInIdentifier } from "./emailAddress";
import { BRAND_NAME } from "./emailShell";
import { RolledBackError } from "./errors";
import { logger } from "./logging";
import { sendMail } from "./mail";
import { buildPasskeyGeloeschtEmail, buildPasskeyHinzugefuegtEmail } from "./passkeyEmail";
import { ENROLMENT_CONFLICT, SIGN_IN_BARRED, SIGN_IN_HOLDS_NOTHING, USER_VERIFICATION_REFUSED } from "./passkeyRefusal";
import { setRequestActor } from "./requestScope";
import { ADMIN_LIFETIME, ENROLMENT_WINDOW_MS, PERSON_LIFETIME, SESSION_EXPIRES_IN_DAYS, STEP_UP_WINDOW_MS } from "./sessionLifetimes";
import { mayReceiveSignIn } from "./signInGate";

import type { BetterAuthOptions, DBTransactionAdapter, GenericEndpointContext } from "better-auth";
import type { PasskeyEmail } from "./passkeyEmail";
import type { Lifetime } from "./sessionLifetimes";

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

// Far below the plugin's own default: a sign-in link is a bearer credential sitting in an inbox.
const LINK_VALIDITY_SECONDS = LINK_VALIDITY_MINUTES * 60;

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
const PASSKEY_FACTOR = "passkey";

/** A code mailed to the address: whoever holds the mailbox holds this factor. */
const CODE_FACTOR = "code";

type AuthFactor = typeof PASSKEY_FACTOR | typeof CODE_FACTOR;

// Every endpoint that mints a session, with the factor it proves. A path missing here mints nothing,
// so one a release adds fails closed rather than handing out a session no guard has classified
// (`docs/frontend/spec.md :: I398`).
const SESSION_FACTOR_BY_PATH: ReadonlyMap<string, AuthFactor> = new Map([
  [PASSKEY_ASSERTION_PATH, PASSKEY_FACTOR],
  [PASSKEY_REGISTRATION_PATH, PASSKEY_FACTOR],
  ["/sign-in/email-otp", CODE_FACTOR],
  // The mailed link proves the mailbox, as the code does; the entry goes with the link itself.
  ["/magic-link/verify", CODE_FACTOR],
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

/** As much of a served session as the step-up judges; every arm below reads one stored row. */
type StepUpCaller = {
  readonly user: { readonly email: string };
  readonly session: { readonly createdAt: Date | string; readonly authFactor?: unknown };
};

function isYoungerThan(createdAt: Date | string, window: number): boolean {
  const created = new Date(createdAt).getTime();

  // An unreadable stamp is no step-up rather than an unbounded one, as `withinLifetime` reads one.
  return Number.isFinite(created) && Date.now() - created < window;
}

function isWithinStepUpWindow(createdAt: Date | string): boolean {
  return isYoungerThan(createdAt, STEP_UP_WINDOW_MS);
}

/** Adding a passkey asks a sign-in or confirmation this recent, whoever adds it (`docs/frontend/spec.md :: I411`). */
function isWithinEnrolmentWindow(createdAt: Date | string): boolean {
  return isYoungerThan(createdAt, ENROLMENT_WINDOW_MS);
}

/**
 * Whether a session was signed in -- or confirmed, which mints a new one -- recently enough to change
 * passkeys and sign-ins: by either factor for a person, by the passkey for an administrator
 * (`docs/frontend/spec.md :: I261`).
 */
export function isFreshlySignedIn(served: StepUpCaller): boolean {
  if (!isWithinStepUpWindow(served.session.createdAt)) return false;

  return !isUserAdmin(served.user.email) || served.session.authFactor === PASSKEY_FACTOR;
}

/**
 * The stamp sits on the stored row and on neither arm's declared type, the library typing both to
 * its own base shape: read through `Reflect` rather than cast, so nothing here claims it is there.
 */
function asStepUpCaller(served: { user: { email: string }; session: object } | null): StepUpCaller | null {
  if (served === null) return null;

  return {
    user: { email: served.user.email },
    session: {
      createdAt: Reflect.get(served.session, "createdAt") as Date | string,
      authFactor: Reflect.get(served.session, "authFactor"),
    },
  };
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
  const bootstrap = held.length === 0 && isUserAdmin(caller.user.email) && caller.session.authFactor === CODE_FACTOR;

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
  const verdict = account === null ? "failed" : await mayReceiveSignIn(account.email);
  if (verdict === "admitted") return;

  // Worded where the ceremony starts (`fl_frontend/src/features/auth/passkeyAnswers.ts`); a failed
  // read is the backend's and not the person's, so it answers as a retry would.
  if (verdict === "barred") throw new APIError("FORBIDDEN", { code: SIGN_IN_BARRED, message: "The address is barred." });
  if (verdict === "holds-nothing") throw new APIError("FORBIDDEN", { code: SIGN_IN_HOLDS_NOTHING, message: "The address holds nothing." });
  throw APIError.fromStatus("SERVICE_UNAVAILABLE");
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
  "/error",
  "/get-access-token",
  "/get-session",
  "/link-social",
  "/list-accounts",
  "/list-sessions",
  "/magic-link/verify",
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
  "/sign-in/magic-link",
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
    // Name only, as the link's own send writes one: a failure here routinely carries the address.
    logger.error("auth.passkey_notice_failed", undefined, {
      error_code: "FE-AUTH-004",
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/** Exported for `fl_frontend/src/features/passkeys/actions.ts`, the one place a removal happens. */
export async function notifyPasskeyRemoved(email: string): Promise<void> {
  await notify(buildPasskeyGeloeschtEmail({ zeitpunkt: new Date(), origin: MAIL_ORIGIN }), email);
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
          if (ctx) await endReplacedSession(ctx, session.token);
        },
      },
    },
  },

  // Off everywhere: the edge meters these paths (`docs/ops/spec.md :: I4`), and the magic-link
  // plugin's own rule would cap the mail path under a second meter nothing there can see.
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
      // An absent `ctx.request` is the library's own test for a call that did not arrive over HTTP,
      // taken by `originCheckMiddleware` and by `requestOnlySessionMiddleware`. Nothing in process
      // is filtered here: those callers are this repository's own code.
      if (ctx.request === undefined) return;

      // The switch above is a denylist, so an endpoint the next upgrade mounts arrives open; this
      // is the default-deny net behind it, over `ctx.path`, the endpoint's own declared route
      // rather than a string derived from the URL a caller sent.
      if (!BROWSER_PATHS.has(ctx.path)) throw APIError.fromStatus("NOT_FOUND");

      if (!ENROLMENT_PATHS.has(ctx.path)) return;

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
      const caller = await getSessionFromCtx(ctx);

      // Refused rather than left to the plugin's `freshSessionMiddleware`, which is mounted only
      // while `registration.requireSession` keeps its default: this arm judges nothing about a
      // session it cannot read, and the in-process arm already refuses one.
      if (caller === null) throw APIError.fromStatus("NOT_FOUND");

      await refuseEnrolment(ctx.context.adapter, caller.user.id, asStepUpCaller(caller));
    }),

    // The `Set-Cookie` the endpoint wrote is untouched: `runAfterHooks` merges this hook's own
    // headers into the response's rather than replacing them, so the credential still travels.
    after: createAuthMiddleware(async (ctx) => {
      if (!CEREMONY_VERIFY_PATHS.has(ctx.path)) return undefined;

      // Left standing where the ceremony was refused, or a refusal is answered as a success.
      if (isAPIError(ctx.context.returned)) return undefined;

      // Here rather than in the callback above, which runs BEFORE the write: a notice sent there
      // would name an enrolment a later refusal never made.
      if (ctx.path === PASSKEY_REGISTRATION_PATH) {
        const enrolled = await getSessionFromCtx(ctx);
        if (enrolled !== null) await notify(buildPasskeyHinzugefuegtEmail({ zeitpunkt: new Date(), origin: MAIL_ORIGIN }), enrolled.user.email);
      }

      // The browser client reads nothing off either body but whether it is there
      // (`@better-auth/passkey/client :: getPasskeyActions`).
      return ctx.json(CEREMONY_DONE);
    }),
  },

  plugins: [
    // `disableSignUp` stays off: every person's row is written at their first verification, so set
    // it the first correct link dies, and the gate below is the only barrier.

    // What bounds who holds a redeemable token is the gate below, and the hash at rest.
    magicLink({
      expiresIn: LINK_VALIDITY_SECONDS,
      // At rest as `fl_backend/app/api/bewerbungen/services.py :: hash_token` holds every other
      // token this league mints; the raw one still reaches the send below.
      storeToken: "hashed",
      async sendMagicLink({ email, token }) {
        // The refusal, whole: an address the gate refuses, for whatever reason, is mailed nothing
        // and this returns as though it had, so every branch is one answer.
        if ((await mayReceiveSignIn(email)) !== "admitted") return;

        // The plugin's own `url` is discarded: a mail gateway spends a link that acts on a GET, so
        // what is mailed is the page whose button completes the sign-in.
        const link = buildAnmeldeLink(token);
        // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is
        // not production must not mail production links (`docs/frontend/spec.md :: I186`).
        const { subject, html, text } = buildMagicLinkEmail(link, frontend_config.AUTH_URL);

        try {
          // Tagged so the delivery webhook can tell this lane from the application flow's and put
          // a bounce on the stream: an administrator whose mailbox refuses mail is locked out, and
          // an untagged event reaches no reader at all.
          await sendMail({ to: email, subject, html, text, tags: { [ANMELDUNG_TAG]: ANMELDUNG_LINK } });
        } catch (failed) {
          // Name only: a failure on this path routinely carries the submitted address, and
          // `fl_frontend/src/core/logFormat.ts :: serializeError` writes a message and stack in full.
          logger.error("auth.link_send_failed", undefined, {
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

          // Asked again here rather than trusted from the hook: this is the last point before the
          // row is written, and it is reached by an `auth.api` call the hook lets through.

          // `ctx.context.session` is put there by the plugin's own `freshSessionMiddleware`, which it
          // mounts only while `registration.requireSession` keeps its default: unset it and this arm
          // sees no factor at all and refuses every enrolment.
          await refuseEnrolment(adapter, user.id, asStepUpCaller(ctx.context.session ?? null), verification.registrationInfo?.credential.id);

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
export async function removePasskey(userId: string, id: string, keptSessionId: string): Promise<PasskeyRemoval> {
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

    // The line is the record: the administrator is refused, and nothing else notes that the removal
    // met a change to this administrator's passkeys or sessions.
    logger.warn("auth.passkey_removal_conflict", { error_code: "FE-AUTH-005" });
    return "conflict";
  }

  async function removeInside(
    held: Pick<DBTransactionAdapter, "findMany" | "update" | "delete" | "deleteMany">,
  ): Promise<Exclude<PasskeyRemoval, "conflict">> {
    // The adapter hands itself back where it opens no transaction, and there the claim below
    // conflicts with nothing: refused rather than admitted unguarded, as the enrolment is.
    if (held === adapter) throw new RemovalOutsideTransaction();

    const rows = await held.findMany<{ id: string }>({
      model: "passkey",
      where: [{ field: "userId", value: userId }],
      limit: PASSKEY_LIMIT + 1,
    });

    // Read off the caller's own rows, so another account's identifier is absent rather than taken.
    if (!rows.some((row) => row.id === id)) return "absent";
    if (rows.length <= 1) return "last";

    await claimAccount(held, userId);
    await held.delete({ model: "passkey", where: [{ field: "id", value: id }] });
    // In the delete's transaction, so a refusal above signs nobody out. A session minted after the
    // transaction's snapshot survives it: closing that needs a session to record its authenticator,
    // which the library does not.
    await held.deleteMany({
      model: "session",
      where: [
        // Every other session, since a session row names no authenticator: the one signed in with
        // the removed passkey is among them.
        { field: "userId", value: userId },
        { field: "id", operator: "ne", value: keptSessionId },
      ],
    });
    return "removed";
  }
}

/** What every guard below is handed; no HTTP route serves it, `/get-session` being disabled. */
type ServedSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

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

// An address added to the allowlist after its session was made is an administrator on the next
// request, and is judged against the administrator's window on that same request.
function isAdminWithinWindow(served: ServedSession): boolean {
  return isUserAdmin(served.user.email) && withinLifetime(served.session, ADMIN_LIFETIME);
}

/**
 * Whether this served session may act as an administrator — allowlisted, inside both of the
 * administrator's figures, and made by the passkey rather than by the mailed link alone.
 */
export function isAdminSession(served: ServedSession): boolean {
  return isAdminWithinWindow(served) && served.session.authFactor === PASSKEY_FACTOR;
}

// React's `cache`, never `"use cache"`, which would hand one request's session to another: one read
// serves every guard of a render pass, and none outside it, where a server action and the proxy
// each read their own.
/**
 * Neither throws nor redirects — hence `get`, not `require` — so it guards nothing on its own line.
 * **Check the return value** (`docs/frontend/spec.md` I8).
 */
export const getAdminSession = cache(async (): Promise<ServedSession | null> => {
  const served = await auth.api.getSession({ headers: await headers() });
  if (!served || !isAdminSession(served)) return null;

  // Recorded here rather than in `runAdminMutation`: a second resolution is another round trip to
  // the session store, and the ordering is load-bearing (`docs/frontend/spec.md` §1.3).
  setRequestActor(asSignInIdentifier(served.user.email));

  return served;
});

/** Where `/signin/weiter` sends the session it was handed. */
export type SignInDestination = "/bereich/admin" | "/signin/passkey" | "/bereich" | "/signin";

export async function getSignInDestination(): Promise<SignInDestination> {
  const requestHeaders = await headers();

  const served = await auth.api.getSession({ headers: requestHeaders });
  if (!served) return "/signin";

  if (isUserAdmin(served.user.email)) {
    // The guard's own verdict rather than a second spelling of it: a condition added there has to
    // move this landing with it, or `/bereich/admin` is offered to somebody the proxy bounces.

    // eslint-disable-next-line local/admin-link -- where a finished sign-in lands; no season is in scope at sign-in
    if (isAdminSession(served)) return "/bereich/admin";

    // Where the passkey page has no step to offer, the session is spent, and an administrator signs in
    // afresh rather than being sent to a person's landing with no way to the step they owe.
    return (await passkeyStepOf(served, requestHeaders)) === null ? "/signin" : "/signin/passkey";
  }

  if (!isWithinPersonLifetime(served.session)) return "/signin";

  return (await passkeyStepOf(served, requestHeaders)) === "offer" ? "/signin/passkey" : "/bereich";
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
async function passkeyStepOf(served: ServedSession, requestHeaders: Headers): Promise<PasskeyStep["step"] | null> {
  const admin = isUserAdmin(served.user.email);

  if (admin ? !isAdminWithinWindow(served) : !isWithinPersonLifetime(served.session)) return null;
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

  const step = await passkeyStepOf(served, requestHeaders);
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
  const folded = asSignInIdentifier(address);

  // The allowlist is judged ahead of the ban at every sign-in, so ending an administrator's sessions
  // here would sign out somebody the next sign-in admits.
  if (isUserAdmin(folded)) return;

  const { adapter } = await auth.$context;

  // Equality on the stored address: every sign-in hands the library the folded form, which it stores
  // lower-cased and so unchanged.
  const account = await adapter.findOne<{ id: string }>({ model: "user", where: [{ field: "email", value: folded }] });
  if (account === null) return;

  // By the account, never by a token: no session's cookie value leaves the store for this.
  await adapter.deleteMany({ model: "session", where: [{ field: "userId", value: account.id }] });
}
