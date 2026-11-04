import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

/**
 * The browser's half of the sign-in: the passkey ceremonies, which are `navigator.credentials` calls no server
 * can make, and the typed code's check. No `baseURL`: the client resolves the serving origin's own `/api/auth`,
 * and a build-time value would ship one deployment's origin to another's browser.
 */
const client = createAuthClient({ plugins: [passkeyClient(), emailOTPClient()] });

type Client = typeof client;

/**
 * A ceremony whose answer's body is typed `unknown`: `fl_frontend/src/core/auth/library.ts` replaces the body of every
 * answer that signs in, so the session and user the plugins type are never there, and a body is read through a parser
 * of the league's own answer (`fl_frontend/src/core/auth/assertionAnswer.ts`).
 */
type Rewritten<Ceremony> = Ceremony extends (...args: infer Args) => Promise<infer Answer>
  ? (...args: Args) => Promise<{ [Key in keyof Answer]: Key extends "data" ? unknown : Answer[Key] }>
  : never;

/** `Base` with `Replaced`'s members in place of its own of those names. */
type With<Base, Replaced> = Omit<Base, keyof Replaced> & Replaced;

/** The client, its three ceremonies answering as the league's server answers them. */
export const authClient: With<
  Client,
  {
    signIn: With<Client["signIn"], { passkey: Rewritten<Client["signIn"]["passkey"]>; emailOtp: Rewritten<Client["signIn"]["emailOtp"]> }>;
    passkey: With<Client["passkey"], { addPasskey: Rewritten<Client["passkey"]["addPasskey"]> }>;
  }
> = client;
