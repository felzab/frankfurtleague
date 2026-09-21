import "server-only";

import { headers } from "next/headers";

import { mongodbAdapter } from "@better-auth/mongo-adapter";
import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { customSession } from "better-auth/plugins/custom-session";
import { magicLink } from "better-auth/plugins/magic-link";

import { buildAnmeldeLink } from "./anmeldeLink";
import { ANMELDUNG_LINK, ANMELDUNG_TAG } from "./anmeldeTag";
import { buildMagicLinkEmail, LINK_VALIDITY_MINUTES } from "./authEmail";
import { frontend_config } from "./config";
import { client } from "./db";
import { asSignInIdentifier } from "./emailAddress";
import { BRAND_NAME } from "./emailShell";
import { logger } from "./logging";
import { sendMail } from "./mail";
import { USER_VERIFICATION_REFUSED } from "./passkeyRefusal";
import { setRequestActor } from "./requestScope";

import type { BetterAuthOptions, DBAdapter } from "better-auth";

// Named for what the database holds rather than for the library that writes it, so the next swap
// inherits a name it does not have to migrate.
const MONGO_DB_NAME = "auth";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How long a session of one kind survives without use, and how long it survives at all. */
type Lifetime = { readonly idle: number; readonly absolute: number };

// ONE figure for the administrator, written into both halves below: `updatedAt` never precedes
// `createdAt`, so where the two are equal the idle comparison can never be the one that refuses.
const ADMIN_WINDOW_MS = 48 * HOUR_MS;

const ADMIN_LIFETIME: Lifetime = { idle: ADMIN_WINDOW_MS, absolute: ADMIN_WINDOW_MS };

// A sliding window with no cap means a stolen cookie used weekly never expires, which is why the
// second figure is here and never redundant (`docs/frontend/spec.md :: I135`).
const PERSON_LIFETIME: Lifetime = { idle: 30 * DAY_MS, absolute: 90 * DAY_MS };

// Derived, never typed a fifth time: the library configures one lifetime for everybody, so it gets
// the longest and `fl_frontend/src/core/auth.ts :: withinLifetime` refuses the rest per request.
const SESSION_EXPIRES_IN_SECONDS =
  Math.max(ADMIN_LIFETIME.idle, ADMIN_LIFETIME.absolute, PERSON_LIFETIME.idle, PERSON_LIFETIME.absolute) / 1000;

// What the refresh costs, and so how closely `updatedAt` tracks activity: the idle windows above
// are compared against it, and this is the width of their granularity.
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

// The plugin answers each of these with the session row it minted, `token` -- the cookie's own
// value -- among its fields (`docs/frontend/spec.md :: I198`).
const CEREMONY_VERIFY_PATHS: ReadonlySet<string> = new Set([PASSKEY_REGISTRATION_PATH, PASSKEY_ASSERTION_PATH]);

/** What every finished ceremony answers instead: the plugin's own shape for a call that carries no record back. */
const CEREMONY_DONE = { status: true };

const PASSKEY_FACTOR = "passkey";
const LINK_FACTOR = "link";

// The whole of the user-verification requirement, asked below and checked under it. Set to
// "preferred" and both halves relax together.

// The check is ours because 1.7.5 hardcodes `requireUserVerification` off in both verifiers and
// "preferred" in the assertion's options, where WebAuthn Level 3 §7.2 has the relying party verify
// the flag. Upstream is open on it.
const USER_VERIFICATION: "required" | "preferred" = "required";

/** Both ceremonies, at the point the plugin reaches before it writes a row or mints a session. */
function refuseUnverified(userVerified: boolean): void {
  if (USER_VERIFICATION !== "required" || userVerified) return;

  throw new APIError("BAD_REQUEST", { code: USER_VERIFICATION_REFUSED, message: "The authenticator did not verify the user." });
}

// One passkey per administrator; recovery is a console step rather than a control anywhere here.

/**
 * The plugin takes a passkey already held for an `excludeCredentials` hint, which a different
 * authenticator ignores -- so nothing in it stops a stolen mailbox enrolling one beside the
 * administrator's own (`docs/frontend/spec.md :: I261`).
 */
async function refuseASecondPasskey(adapter: DBAdapter, userId: string): Promise<void> {
  const held = await adapter.findMany({ model: "passkey", where: [{ field: "userId", value: userId }], limit: 1 });

  // The default-deny net's own answer, so an enrolment the page never offers names no surface either.
  if (held.length > 0) throw APIError.fromStatus("NOT_FOUND");
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

export function isUserAdmin(email?: string | null): boolean {
  if (!email || !frontend_config.ALLOWED_ADMIN_EMAILS) return false;

  // Folded here because the library folds only CASE, and only on the row it stores: the address a
  // send is judged on arrives exactly as it was typed, and an allowlist entry is stored NFKC-folded
  // (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`).
  return frontend_config.ALLOWED_ADMIN_EMAILS.includes(asSignInIdentifier(email));
}

export const auth = betterAuth({
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
      if (typeof asked === "object" && asked !== null && "createSession" in asked) throw APIError.fromStatus("BAD_REQUEST");

      // The plugin gates both halves on `freshAge` alone, which the link's own session is inside.
      const caller = await getSessionFromCtx(ctx);
      if (caller !== null) await refuseASecondPasskey(ctx.context.adapter, caller.user.id);
    }),

    // The `Set-Cookie` the endpoint wrote is untouched: `runAfterHooks` merges this hook's own
    // headers into the response's rather than replacing them, so the credential still travels.
    after: createAuthMiddleware(async (ctx) => {
      if (!CEREMONY_VERIFY_PATHS.has(ctx.path)) return undefined;

      // Left standing where the ceremony was refused, or a refusal is answered as a success.
      if (isAPIError(ctx.context.returned)) return undefined;

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

    // `userVerification` is requested at enrolment and never at the assertion: 1.7.5 hardcodes the
    // assertion's, and verifies the flag on neither response.
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

          // Asked again here rather than trusted from the hook: this is the last point before the
          // row is written, and it is reached by an `auth.api` call the hook lets through.
          await refuseASecondPasskey(ctx.context.adapter, user.id);
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
});

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

/**
 * Neither throws nor redirects — hence `get`, not `require` — so it guards nothing on its own line.
 * **Check the return value** (`docs/frontend/spec.md` I8).
 */
export async function getAdminSession(): Promise<ServedSession | null> {
  const served = await auth.api.getSession({ headers: await headers() });
  if (!served || !isAdminSession(served)) return null;

  // Recorded here rather than in `runAdminMutation`: a second resolution is another round trip to
  // the session store, and the ordering is load-bearing (`docs/frontend/spec.md` §1.3).
  setRequestActor(asSignInIdentifier(served.user.email));

  return served;
}

/** Where `/signin/weiter` sends the session it was handed. */
export type SignInDestination = "/admin" | "/signin/passkey" | "/" | "/signin";

export async function getSignInDestination(): Promise<SignInDestination> {
  const served = await auth.api.getSession({ headers: await headers() });
  if (!served) return "/signin";

  if (isUserAdmin(served.user.email)) {
    // The guard's own verdict rather than a second spelling of it: a condition added there has to
    // move this landing with it, or `/admin` is offered to somebody the proxy bounces.
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

  // The same question `refuseASecondPasskey` puts to the adapter, asked here through the plugin
  // because the served session is narrowed past the user id: they agree or the page offers a
  // control the server refuses, which `fl_frontend/src/core/auth.test.ts` drives over one row.
  const held = await auth.api.listPasskeys({ headers: requestHeaders });

  // The address travels with the verdict: the page renders it, and a second read for it would be a
  // third round trip to the session store on one load.

  // Folded as `getAdminSession` folds the actor it records: the stored row is the library's own
  // spelling, and this is the one address of this slice a person reads.
  return { step: held.length === 0 ? "enrol" : "assert", email: asSignInIdentifier(served.user.email) };
}
