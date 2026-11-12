/**
 * The assertion's session-creating path in `@better-auth/passkey`, whose `signIn.passkey` is a client helper over
 * two endpoints rather than a route.
 */
export const PASSKEY_ASSERTION_PATH = "/passkey/verify-authentication";

/** `body.response.id` read without trusting the body's shape, which is whatever the caller posted. */
export function declaredCredentialId(ctx: { readonly body?: unknown }): unknown {
  const response: unknown = typeof ctx.body === "object" && ctx.body !== null ? Reflect.get(ctx.body, "response") : undefined;
  return typeof response === "object" && response !== null ? Reflect.get(response, "id") : undefined;
}
