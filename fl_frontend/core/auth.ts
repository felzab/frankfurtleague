import NextAuth from "next-auth";
import { MongoDBAdapter } from "@auth/mongodb-adapter";
import Resend from "next-auth/providers/resend";
import client from "./db";
import { frontend_config } from "./config";

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
  pages: { error: "/signin" },

  logger: {
    error(error) {
      // Check if the error is an AccessDenied error
      if (error?.name === "AccessDenied" || error?.message?.includes("AccessDenied")) {
        console.warn("An AccessDenied (auth.js) error was silenced.");
        return;
      }

      // Otherwise, log the error normally
      console.error(error);
    },
  },
});
