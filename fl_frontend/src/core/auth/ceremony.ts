import "server-only";

import { APIError } from "better-auth/api";
import { MongoServerError } from "mongodb";

import { declaredCredentialId } from "../passkeyCeremony";
import { DUPLICATE_KEY } from "./signInRows";

import type { GenericEndpointContext } from "better-auth";

/** A second row for a credential `fl_frontend/src/core/authIndexes.ts` already holds one of. */
export function isDuplicateCredential(failed: unknown): boolean {
  return failed instanceof MongoServerError && failed.code === DUPLICATE_KEY && "credentialID" in (failed.keyPattern ?? {});
}

/** Named for the same reason as `ClaimMatchedNoAccount`. */
class CeremonyNamedNoCredential extends Error {
  override name = "CeremonyNamedNoCredential";
}

/**
 * The credential a finished passkey ceremony proved. The assertion looked its row up by this id and
 * verified the signature against that row's key; the registration's is held to the attested id in
 * `registration.afterVerification`, the verifier comparing the two nowhere.
 */
export function ceremonyCredentialId(ctx: Pick<GenericEndpointContext, "body">): string {
  const declared = declaredCredentialId(ctx);
  if (typeof declared !== "string" || declared === "") throw new CeremonyNamedNoCredential();

  return declared;
}

/** The plugin's own name for its challenge cookie, which its options leave at the default here. */
const PASSKEY_CHALLENGE_COOKIE = "better-auth-passkey";

/**
 * A signed-in page's challenge names its account, and the plugin checks the credential, never whose:
 * another account's passkey would sign that account in and end the page's session.
 */
export async function refuseAnotherAccountsPasskey(ctx: GenericEndpointContext): Promise<void> {
  const token = await ctx.getSignedCookie(ctx.context.createAuthCookie(PASSKEY_CHALLENGE_COOKIE).name, ctx.context.secret);
  // Left to the plugin, which refuses a missing or spent challenge itself.
  if (typeof token !== "string" || token === "") return;

  const challenge = await ctx.context.internalAdapter.findVerificationValue(token);
  if (challenge === null) return;

  const parsed: unknown = JSON.parse(challenge.value);
  const userData: unknown = typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "userData") : undefined;
  const expected: unknown = typeof userData === "object" && userData !== null ? Reflect.get(userData, "id") : undefined;
  if (typeof expected !== "string" || expected === "") return;

  const credentialID = declaredCredentialId(ctx);
  if (typeof credentialID !== "string" || credentialID === "") return;

  const answered = await ctx.context.adapter.findOne<{ userId: string }>({
    model: "passkey",
    where: [{ field: "credentialID", value: credentialID }],
  });
  if (answered !== null && answered.userId !== expected) throw APIError.fromStatus("UNAUTHORIZED");
}
