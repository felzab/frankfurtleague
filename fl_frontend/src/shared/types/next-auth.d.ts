/**
 * SHARED · next-auth module augmentation
 *
 * Adds `role` to Auth.js's session, user and adapter-user shapes. All three are augmented rather than
 * just `Session`: the adapter writes the field and the callbacks read it, so augmenting only the one
 * you happen to touch leaves the other end silently `any`.
 */

import { type DefaultSession } from "next-auth";

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
