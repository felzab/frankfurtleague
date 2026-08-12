/**
 * CORE · authentication
 *
 * Auth.js with a Resend magic-link provider. Admin is an email ALLOWLIST, not a stored role —
 * checked at sign-in and again when the session is built.
 *
 * Invariants:
 * - The ONE place the frontend touches MongoDB directly, and only the `authjs` database (ADR-0007).
 * - `getAdminSession()` is the single admin policy; it neither throws nor redirects, so check it.
 * - `role` is re-derived from ALLOWED_ADMIN_EMAILS on every session read, never stamped at
 *   sign-in — removing an address takes effect on the next request, not at expiry.
 *
 * See:
 * - docs/frontend/overview.md — the authentication section
 */

import "server-only";

import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";

import { buildMagicLinkEmail } from "./authEmail";
import { frontend_config } from "./config";
import { client } from "./db";
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
      // 15 minutes, down from the provider's 24-hour default: a sign-in link is a bearer credential
      // sitting in an inbox. `LINK_VALIDITY_TEXT` in `authEmail.ts` states this number to the reader
      // -- keep the two in step.
      maxAge: 15 * 60,
      /**
       * Replaces Auth.js's stock template, which sends an English subject ("Sign in to …") and a
       * generic body on a German-only site. The message itself lives in `features/auth/email.ts` —
       * edit it there, not here. This function is only the transport.
       *
       * Mirrors the provider's own implementation (`@auth/core/providers/resend.js`): same endpoint,
       * same auth header, same error shape, so a Resend failure still surfaces the API's message.
       */
      async sendVerificationRequest({ identifier: to, provider, url }) {
        const { subject, html, text } = buildMagicLinkEmail(url);

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ from: provider.from, to, subject, html, text }),
        });

        if (!res.ok) throw new Error("Resend error: " + JSON.stringify(await res.json()));
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
  // Without `signIn`, Auth.js keeps its own unbranded form live at /api/auth/signin -- a second,
  // unthrottled entry point to the same email-send surface, on a URL the app never links to.
  pages: { signIn: "/signin", error: "/signin" },

  // 48 hours, long enough to span a weekend of matchdays without a fresh sign-in mid-round, for an
  // interface whose only purpose is mutating league data. Sign-out ends a session on demand, and the
  // `session` callback above re-derives `role` on every read.
  session: {
    maxAge: 60 * 60 * 48,
    updateAge: 60 * 60, // refresh the DB row at most hourly
  },

  // Explicit rather than inherited from @auth/core's own derivation, so a change to its cookie
  // defaults cannot silently drop the flag. `config.ts` already refuses a non-loopback http:// value.

  // Deliberately a string test and not `new URL(...)`: this is evaluated at module scope, and the
  // Docker builder stage has no AUTH_URL at all, so constructing a URL here fails the image build
  // (ADR-0006).
  useSecureCookies: (frontend_config.AUTH_URL ?? "").toLowerCase().startsWith("https://"),

  logger: {
    error(error) {
      // Matched on the type only: an unbounded `message.includes("AccessDenied")` test would swallow
      // any wrapped or aggregated error quoting the string, and this stream is the main signal that
      // authorization is misbehaving.
      if (error?.name === "AccessDenied") {
        logger.warn("auth.access_denied", { name: error.name, error_code: "FE-AUTH-001" });
        return;
      }

      // Routed through the structured logger: raw console.error emitted the whole Error, and Auth.js
      // errors on the Resend path routinely carry the submitted email address.
      logger.error("auth.error", error, { name: error?.name, error_code: "FE-AUTH-002" });
    },
  },
});

/**
 * The single definition of the admin policy. Returns the session when the caller is an admin, and
 * `null` when it is not -- the caller decides whether that means `redirect()` or a refused action.
 *
 * Named `get...`, not `require...`, on purpose: `await getAdminSession();` on its own line guards
 * nothing. **The return value must be checked.**
 *
 * One definition for all eight callers (seven server actions plus the proxy): spelling the test out
 * at each site would make a change of policy eight edits, and a missed one invisible.
 */
export async function getAdminSession(): Promise<Session | null> {
  const session = await auth();
  return session?.user?.role === "admin" ? session : null;
}
