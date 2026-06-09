import { type DefaultSession } from "next-auth";

declare module "next-auth" {
  // Extends the built-in session.user object
  interface Session {
    user: {
      role: string;
    } & DefaultSession["user"];
  }

  // Extends the built-in user object
  interface User {
    role: string;
  }
}

declare module "next-auth/adapters" {
  // Extends the database user object specifically
  interface AdapterUser {
    role: string;
  }
}
