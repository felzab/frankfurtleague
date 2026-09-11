import "server-only";

import { after } from "next/server";

import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { buildMagicLinkEmail } from "./authEmail";
import { frontend_config } from "./config";
import { client } from "./db";
import { logger } from "./logging";
import { sendMail } from "./mail";
import { setRequestActor } from "./requestScope";

import type { Session } from "next-auth";

const MONGO_DB_NAME = "authjs";

// A string test, not `new URL(...)`: this runs at module scope, where the builder stage has no
// AUTH_URL and the construction would fail the image build.
const USE_SECURE_COOKIES = (frontend_config.AUTH_URL ?? "").toLowerCase().startsWith("https://");

/**
 * The callback-url cookie under the name and options `@auth/core` gives it: the `__Secure-` prefix
 * follows the flag above, so a write spelled without both is one the browser drops. The emailed
 * link carries its own `callbackUrl`, which outranks it.
 */
export const CALLBACK_URL_COOKIE = {
  name: `${USE_SECURE_COOKIES ? "__Secure-" : ""}authjs.callback-url`,
  path: "/",
  httpOnly: true,
  sameSite: "lax",
  secure: USE_SECURE_COOKIES,
} as const;

function isUserAdmin(email?: string | null) {
  if (!email || !frontend_config.ALLOWED_ADMIN_EMAILS) return false;
  return frontend_config.ALLOWED_ADMIN_EMAILS.includes(email);
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: MongoDBAdapter(client, { databaseName: MONGO_DB_NAME }),
  providers: [
    Resend({
      // Far below the provider's default: a sign-in link is a bearer credential sitting in an inbox.
      // `fl_frontend/src/core/authEmail.ts :: LINK_VALIDITY_TEXT` states it to the reader -- keep
      // the two in step.
      maxAge: 15 * 60,
      /**
       * Transport only — the message is `fl_frontend/src/core/authEmail.ts`, the send is
       * `fl_frontend/src/core/mail.ts :: sendMail`, which owns the sender. Setting the provider's
       * `from` or `apiKey` here configures a path nothing reads.
       */
      async sendVerificationRequest({ identifier: to, url }) {
        // The serving origin, never `fl_frontend/src/core/brand.ts :: SITE_URL`: a stack that is not
        // production must not mail production links (`docs/frontend/spec.md :: I186`).
        const { subject, html, text } = buildMagicLinkEmail(url, frontend_config.AUTH_URL);

        // Behind the response rather than inside it: a rejected sign-in cannot have the provider's
        // latency, so awaiting this re-opens the membership oracle the action's floor only narrows
        // (`fl_frontend/src/features/auth/actions.ts :: handleSignIn`).
        after(async () => {
          try {
            await sendMail({ to, subject, html, text });
          } catch (failed) {
            // The only line a failed link leaves: Auth.js's own logger sits in front of the
            // response and never sees this.
            logger.error("auth.link_send_failed", undefined, {
              error_code: "FE-AUTH-002",
              name: failed instanceof Error ? failed.name : "unknown",
            });
          }
        });
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      return isUserAdmin(user?.email);
    },
    // Built fresh, never the argument returned whole: under the database strategy that argument is
    // the adapter's session row, and returning it serves the `httpOnly` cookie's own value
    // (`docs/frontend/spec.md :: I198`).
    async session({ session, user }) {
      return {
        expires: session.expires,
        user: {
          name: user?.name,
          email: user?.email,
          image: user?.image,
          role: isUserAdmin(user?.email) ? "admin" : "user",
        },
      };
    },
  },
  // Auth.js's built-in sign-in FORM, which this replaces. It does not move the POST that mails
  // the link -- `pages` is read on the GET branch alone -- so `nginx/prod.conf ::
  // location /api/auth/signin` is what meters that.
  pages: { signIn: "/signin", error: "/signin" },

  // Long enough to span a weekend of matchdays without a sign-in mid-round. `role` is re-derived on
  // every read by the `session` callback above, so removing an address takes effect immediately.
  session: {
    maxAge: 60 * 60 * 48,
    updateAge: 60 * 60,
  },

  // Set explicitly, so a change to the `@auth/core` cookie defaults cannot silently drop the flag.
  useSecureCookies: USE_SECURE_COOKIES,

  logger: {
    error(error) {
      // On the type only: a `message.includes(...)` test would swallow any wrapped error quoting the
      // string, and this stream is the main signal that authorization is misbehaving.
      if (error?.name === "AccessDenied") {
        logger.warn("auth.access_denied", { error_code: "FE-AUTH-001", name: error.name });
        return;
      }

      // Name only: an Auth.js error on the Resend path routinely carries the submitted email
      // address, and `fl_frontend/src/core/logFormat.ts :: serializeError` writes an error's
      // message and stack in full.
      logger.error("auth.error", undefined, { error_code: "FE-AUTH-002", name: error?.name });
    },
  },
});

/**
 * Neither throws nor redirects — hence `get`, not `require` — so it guards nothing on its own line.
 * **Check the return value** (`docs/frontend/spec.md` I8).
 */
export async function getAdminSession(): Promise<Session | null> {
  const session = await auth();
  if (session?.user?.role !== "admin") return null;

  // Recorded here rather than in `runAdminMutation`: a second resolution is another round trip to
  // the session store, and the ordering is load-bearing (`docs/frontend/spec.md` §1.3).
  setRequestActor(session.user.email);

  return session;
}
