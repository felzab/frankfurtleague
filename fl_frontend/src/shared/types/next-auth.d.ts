import { type DefaultSession } from "next-auth";

// All three shapes are augmented rather than just `Session`: the adapter writes `role` and the callbacks
// read it, so augmenting only the one you happen to touch leaves the other end silently `any`.
declare module "next-auth" {
  interface Session {
    user: {
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
  }
}

declare module "next-auth/adapters" {
  interface AdapterUser {
    role: string;
  }
}
