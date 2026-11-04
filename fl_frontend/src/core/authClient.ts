import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";

/**
 * The browser's half of the sign-in: the passkey ceremonies, which are `navigator.credentials` calls no server
 * can make, and the typed code's check. No `baseURL`: the client resolves the serving origin's own `/api/auth`,
 * and a build-time value would ship one deployment's origin to another's browser.
 */
export const authClient = createAuthClient({ plugins: [passkeyClient(), emailOTPClient()] });
