import { type DefaultSession } from "next-auth";

// Augmented on `Session` alone, which is where the callback composes it:
// `fl_frontend/src/core/auth.ts :: getAdminSession` and `fl_frontend/src/proxy.ts` are its readers.
declare module "next-auth" {
  interface Session {
    user: {
      role: string;
    } & DefaultSession["user"];
  }
}
