import "server-only";

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
        const { subject, html, text } = buildMagicLinkEmail(url);

        await sendMail({ to, subject, html, text });
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      return isUserAdmin(user?.email);
    },
    async session({ session, user }) {
      session.user.role = isUserAdmin(user?.email) ? "admin" : "user";
      return session;
    },
  },
  // Without `signIn`, Auth.js keeps its own form live at /api/auth/signin: a second, unthrottled
  // entry point to the same email-send surface.
  pages: { signIn: "/signin", error: "/signin" },

  // Long enough to span a weekend of matchdays without a sign-in mid-round. `role` is re-derived on
  // every read by the `session` callback above, so removing an address takes effect immediately.
  session: {
    maxAge: 60 * 60 * 48,
    updateAge: 60 * 60,
  },

  // Set explicitly, so a change to @auth/core's cookie defaults cannot silently drop the flag. A
  // string test, not `new URL(...)`: this runs at module scope, where the builder stage has no
  // AUTH_URL and the construction would fail the image build.
  useSecureCookies: (frontend_config.AUTH_URL ?? "").toLowerCase().startsWith("https://"),

  logger: {
    error(error) {
      // On the type only: a `message.includes(...)` test would swallow any wrapped error quoting the
      // string, and this stream is the main signal that authorization is misbehaving.
      if (error?.name === "AccessDenied") {
        logger.warn("auth.access_denied", { name: error.name, error_code: "FE-AUTH-001" });
        return;
      }

      // Name only: an Auth.js error on the Resend path routinely carries the submitted email
      // address, and `fl_frontend/src/core/logFormat.ts :: serializeError` writes an error's
      // message and stack in full.
      logger.error("auth.error", undefined, { name: error?.name, error_code: "FE-AUTH-002" });
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
