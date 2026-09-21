import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";

/**
 * The browser's half of the passkey ceremonies, which are `navigator.credentials` calls no server
 * can make. No `baseURL`: the client resolves the serving origin's own `/api/auth`, and a build-time
 * value would ship one deployment's origin to another's browser.
 */
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
