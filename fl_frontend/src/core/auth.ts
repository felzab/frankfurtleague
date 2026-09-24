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
import { ENROLMENT_CONFLICT, USER_VERIFICATION_REFUSED } from "./passkeyRefusal";
import { setRequestActor } from "./requestScope";
import { ADMIN_LIFETIME, ADMIN_WINDOW_MS, PERSON_LIFETIME, SESSION_EXPIRES_IN_DAYS } from "./sessionLifetimes";

import type { BetterAuthOptions, DBTransactionAdapter } from "better-auth";
import type { PasskeyEmail } from "./passkeyEmail";
import type { Lifetime } from "./sessionLifetimes";

// Named for what the database holds rather than for the library that writes it, so the next swap
// inherits a name it does not have to migrate.
const MONGO_DB_NAME = "auth";

// Minutes, which is what WebAuthn practice and the large providers' documented re-authentication
// ask for. It shrinks the exposure rather than closing it: inside those minutes a stolen cookie
// still acts (`docs/frontend/spec.md :: I261`).
const STEP_UP_WINDOW_MS = 5 * 60 * 1000;

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

// The one session-creating path the passkey plugin mounts, read off `@better-auth/passkey` 1.7.5 on
// 2026-09-20: its `signIn.passkey` is a client helper over two endpoints rather than a route.
const PASSKEY_ASSERTION_PATH = "/passkey/verify-authentication";

const PASSKEY_REGISTRATION_PATH = "/passkey/verify-registration";

// Both halves of an enrolment, which the plugin gates on `freshAge` and on nothing else -- so the
// hook below is the whole of what a link-borne session meets on either.
const ENROLMENT_PATHS: ReadonlySet<string> = new Set(["/passkey/generate-register-options", PASSKEY_REGISTRATION_PATH]);

// Two fields the plugin's schemas take and this league's client never sends: one swaps the caller's
// session for one nothing asked for, the other titles the row on the surface built to spot it.
const ENROLMENT_FIELDS_REFUSED: readonly string[] = ["createSession", "name"];

// The plugin answers each of these with the session row it minted, `token` -- the cookie's own
// value -- among its fields (`docs/frontend/spec.md :: I198`).
const CEREMONY_VERIFY_PATHS: ReadonlySet<string> = new Set([PASSKEY_REGISTRATION_PATH, PASSKEY_ASSERTION_PATH]);

/** What every finished ceremony answers instead: the plugin's own shape for a call that carries no record back. */
const CEREMONY_DONE = { status: true };

const PASSKEY_FACTOR = "passkey";
const LINK_FACTOR = "link";

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

/** As much of the enrolling session as either arm can see; both arms read one stored row. */
type Enroller = { readonly email?: string | null; readonly authFactor?: unknown; readonly createdAt?: Date | string };

/**
 * Whether the authenticator itself answered recently enough for a session to manage passkeys.
 * Exported for `fl_frontend/src/features/passkeys/actions.ts`, which asks it of a removal.
 */
export function isRecentlyAsserted(createdAt?: Date | string): boolean {
  const created = new Date(createdAt ?? Number.NaN).getTime();

  // An unreadable stamp is no step-up rather than an unbounded one, as `withinLifetime` reads one.
  return Number.isFinite(created) && Date.now() - created < STEP_UP_WINDOW_MS;
}

/**
 * The stamp sits on the stored row and on neither arm's declared type, the library typing both to
 * its own base shape: read through `Reflect` rather than cast, so nothing here claims it is there.
 */
function asEnroller(served: { user: { email: string }; session: object } | null): Enroller {
  if (served === null) return {};

  return {
    email: served.user.email,
    authFactor: Reflect.get(served.session, "authFactor"),
    createdAt: Reflect.get(served.session, "createdAt") as Date | string | undefined,
  };
}

/**
 * Every condition an enrolment meets, on both arms. The plugin gates its two registration endpoints
 * on `freshAge` and on nothing else, which a link-borne session is inside
 * (`docs/frontend/spec.md :: I261`).
 */
async function refuseEnrolment(adapter: DBTransactionAdapter, userId: string, caller: Enroller, credentialID?: string): Promise<void> {
  // Every refusal below is the default-deny net's own answer, so an enrolment the page never offers
  // names no surface either.
  if (!isUserAdmin(caller.email)) throw APIError.fromStatus("NOT_FOUND");

  const held = await adapter.findMany<{ credentialID?: string }>({
    model: "passkey",
    where: [{ field: "userId", value: userId }],
    limit: PASSKEY_LIMIT + 1,
  });

  // The mailed link enrols the first passkey and only ever that one: past it a stolen mailbox would
  // put its own authenticator beside the administrator's and never need the administrator's again.
  const bootstrap = held.length === 0 && caller.authFactor === LINK_FACTOR;
  const further = caller.authFactor === PASSKEY_FACTOR && isRecentlyAsserted(caller.createdAt);

  if (!bootstrap && !further) throw APIError.fromStatus("NOT_FOUND");
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

/** Where every finished sign-in step lands: the one page that decides where a session goes next. */
export const SIGN_IN_LANDING = "/signin/weiter";

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
  // The library gates passkey REGISTRATION on this figure, measured from `createdAt`, and defaults
  // it to a day: left there, every enrolment an administrator is offered after hour 24 is refused.
  freshAge: ADMIN_WINDOW_MS / 1000,
  // Off, so revocation stays a store read on every request and the guards below judge a stored
  // row rather than a signed copy of one.
  cookieCache: { enabled: false },
  additionalFields: {
    // `input: false` is the whole defence: left writable, any holder of any session stamps itself
    // as passkey-verified through the library's own `POST /update-session`.
    authFactor: { type: "string", required: false, input: false },
  },
} satisfies BetterAuthOptions["session"];

function isUserAdmin(email?: string | null): boolean {
  if (!email || !frontend_config.ALLOWED_ADMIN_EMAILS) return false;

  // Folded here because the library folds only CASE, and only on the row it stores: the address a
  // send is judged on arrives exactly as it was typed, and an allowlist entry is stored folded
  // (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`).
  return frontend_config.ALLOWED_ADMIN_EMAILS.includes(asSignInIdentifier(email));
}

const authOptions = {
  // The `Db` off the one client this process opens, never a second connection
  // (`docs/frontend/spec.md :: I120`).
  database: mongodbAdapter(client.db(MONGO_DB_NAME), { client }),

  // Passed rather than left to the environment: the library reads no bare `AUTH_URL`, and this
  // value also decides the `__Secure-` cookie prefix and the passkey relying-party id.
  baseURL: frontend_config.AUTH_URL ?? AUTH_ORIGIN.origin,
  secret: frontend_config.AUTH_SECRET,

  session: sessionOptions,

  // The library stores the caller's address on every session row, and nothing here reads one: the
  // limiter that would is off below (`docs/ops/spec.md :: I4`).

  // The edge's own access line already carries the address, under a bound (`docs/datenschutz.md` §6).
  advanced: { ipAddress: { disableIpTracking: true } },

  databaseHooks: {
    session: {
      create: {
        // The link's verification and the passkey assertion write identical rows, so the endpoint
        // path is the only thing separating them. This stamps; the guards below decide.
        before: async (session, ctx) => ({
          data: {
            ...session,
            // Emptied here because the library offers no switch for it, beside the one above that
            // empties the address: a second copy of the caller under no retention clock.
            userAgent: "",
            authFactor: ctx?.path === PASSKEY_ASSERTION_PATH ? PASSKEY_FACTOR : LINK_FACTOR,
          },
        }),
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

      // The plugin gates both halves on `freshAge` alone, which the link's own session is inside.
      const caller = await getSessionFromCtx(ctx);

      // Refused rather than left to the plugin's `freshSessionMiddleware`, which is mounted only
      // while `registration.requireSession` keeps its default: this arm judges nothing about a
      // session it cannot read, and the in-process arm already refuses one.
      if (caller === null) throw APIError.fromStatus("NOT_FOUND");

      await refuseEnrolment(ctx.context.adapter, caller.user.id, asEnroller(caller));
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
    // `disableSignUp` stays off: every administrator's row is written at their first verification,
    // so set it the first correct link dies.

    // What bounds who holds a redeemable token is the allowlist below, and the hash at rest.
    magicLink({
      expiresIn: LINK_VALIDITY_SECONDS,
      // At rest as `fl_backend/app/api/bewerbungen/services.py :: hash_token` holds every other
      // token this league mints; the raw one still reaches the send below.
      storeToken: "hashed",
      async sendMagicLink({ email, token }) {
        // The refusal, whole: an address the allowlist does not carry is mailed nothing and this
        // returns as though it had, so both branches are one answer.
        if (!isUserAdmin(email)) return;

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
          await refuseEnrolment(adapter, user.id, asEnroller(ctx.context.session ?? null), verification.registrationInfo?.credential.id);

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
        user: { email: user.email },
        session: {
          // The row's id and never its token: the passkey removal keeps the one session it ran in by it.
          id: session.id,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          authFactor: session.authFactor,
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

// React's `cache`, one read per render pass however many guards ask, and never `"use cache"`, which
// would hand one request's session to another. The proxy runs outside the render and reads its own.
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
export type SignInDestination = "/admin" | "/signin/passkey" | "/" | "/signin";

export async function getSignInDestination(): Promise<SignInDestination> {
  const served = await auth.api.getSession({ headers: await headers() });
  if (!served) return "/signin";

  if (isUserAdmin(served.user.email)) {
    // The guard's own verdict rather than a second spelling of it: a condition added there has to
    // move this landing with it, or `/admin` is offered to somebody the proxy bounces.

    // eslint-disable-next-line local/admin-link -- where a finished sign-in lands; no season is in scope at sign-in
    if (isAdminSession(served)) return "/admin";

    // Past either figure the session is spent, and an administrator asks for a fresh link rather
    // than being sent to the public root with no way back.
    return isAdminWithinWindow(served) ? "/signin/passkey" : "/signin";
  }

  return isWithinPersonLifetime(served.session) ? "/" : "/signin";
}

/** Which half of `/signin/passkey` the caller is standing in front of, and whose address it is. */
export type PasskeyStep = { readonly step: "enrol" | "assert"; readonly email: string };

/** `null` where that page is not the caller's to see. */
export async function getPasskeyStep(): Promise<PasskeyStep | null> {
  const requestHeaders = await headers();

  const served = await auth.api.getSession({ headers: requestHeaders });
  if (!served || !isAdminWithinWindow(served)) return null;
  // A session the passkey already made needs neither half, whatever it holds.
  if (isAdminSession(served)) return null;

  // Completing an enrolment leaves the link-borne session standing, so holding a passkey is what
  // decides which control the page offers rather than whether it offers one.

  // The same question `refuseEnrolment` puts to the adapter, asked here through the plugin
  // because the served session is narrowed past the user id: they agree or the page offers a
  // control the server refuses, which `fl_frontend/src/core/auth.test.ts` drives over one row.
  const held = await auth.api.listPasskeys({ headers: requestHeaders });

  // The address travels with the verdict: the page renders it, and a second read for it would be a
  // third round trip to the session store on one load.

  // Folded as `getAdminSession` folds the actor it records: the stored row is the library's own
  // spelling, and this is the one address of this slice a person reads.
  return { step: held.length === 0 ? "enrol" : "assert", email: asSignInIdentifier(served.user.email) };
}
