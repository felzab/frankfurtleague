import "server-only";

import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { frontend_config } from "./config";
import client from "./db";
import { logger } from "./logging";

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
      from: "no-reply@frankfurtleague.de",
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      return isUserAdmin(user?.email);
    },
    async session({ session, user }) {
      // With a DB adapter, 'user' is the record from MongoDB
      session.user.role = isUserAdmin(user?.email) ? "admin" : "user";
      return session;
    },
  },
  // Without `signIn`, Auth.js keeps its own unbranded form live at /api/auth/signin -- a second,
  // unthrottled entry point to the same email-send surface, on a URL the app never links to.
  pages: { signIn: "/signin", error: "/signin" },

  // Default is a 30-day sliding window, for an interface whose only purpose is mutating league data.
  // There is still no in-app sign-out, so the lifetime is the only revocation mechanism.
  session: {
    maxAge: 60 * 60 * 8, // 8h -- one working session
    updateAge: 60 * 60, // refresh the DB row at most hourly
  },

  // Explicit rather than inherited from AUTH_URL's protocol, so a change to @auth/core's cookie
  // defaults cannot silently drop the flag. config.ts already refuses a non-loopback http:// value.
  useSecureCookies: new URL(frontend_config.AUTH_URL).protocol === "https:",

  logger: {
    error(error) {
      // Matched on the type only. The previous `message.includes("AccessDenied")` clause was an
      // unbounded substring test that would silently swallow any wrapped or aggregated error
      // quoting the string -- and this stream is the main signal that authorization is misbehaving.
      if (error?.name === "AccessDenied") {
        logger.warn("auth.access_denied", { name: error.name });
        return;
      }

      // Routed through the structured logger: raw console.error emitted the whole Error, and Auth.js
      // errors on the Resend path routinely carry the submitted email address.
      logger.error("auth.error", error, { name: error?.name });
    },
  },
});

/**
 * The single definition of the admin policy. Returns the session when the caller is an admin, and
 * `null` when it is not -- the caller decides whether that means `redirect()` or a refused action.
 *
 * The test was previously written out at eight sites (seven server actions plus the proxy), so a
 * change of policy meant eight edits and missing one of them was invisible.
 */
export async function requireAdmin(): Promise<Session | null> {
  const session = await auth();
  return session?.user?.role === "admin" ? session : null;
}
