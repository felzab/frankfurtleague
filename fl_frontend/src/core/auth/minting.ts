import "server-only";

import { APIError } from "better-auth/api";
import { makeSignature } from "better-auth/crypto";

import { now } from "../clock";
import { logger } from "../logging";
import { SIGN_IN_REFUSED } from "../passkeyRefusal";
import { mayReceiveSignIn, signInVerdictOf } from "../signInGate";
import { carriedEnrolmentRead } from "./enrolment";
import { REPLACED_SESSION_FIELD } from "./sessionStamps";
import { EVERY_ROW } from "./signInRows";

import type { AuthContext, GenericEndpointContext } from "better-auth";

/** The session cookie a sign-in's request carried, which names the session it replaces, or `null`. */
export async function replacedToken(ctx: GenericEndpointContext): Promise<string | null> {
  // The cookie rather than `getSessionFromCtx`, whose read refreshes the replaced row and writes a
  // `Set-Cookie` for it into the very response that carries the new one.
  const replaced = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
  return typeof replaced === "string" && replaced !== "" ? replaced : null;
}

/**
 * What every session minted to replace one cookie is stamped with. Keyed and prefixed, so the row holds
 * neither the replaced token nor the signature half of its cookie, which is the same key over the bare token.
 */
export function lineageOf(replaced: string, secret: string): Promise<string> {
  return makeSignature(`replaced-session:${replaced}`, secret);
}

/**
 * Whether `row` was inserted before `minted`: by `updatedAt`, stamped at the insert where `createdAt` dates
 * the gate read, a tie in the millisecond going by id, as the Mongo adapter's `ObjectId`s rise with each
 * insert this process makes.
 */
function mintedBefore(row: { id: string; updatedAt: Date | string }, minted: { id: string; updatedAt: Date | string }): boolean {
  const rowAt = new Date(row.updatedAt).getTime();
  const mintedAt = new Date(minted.updatedAt).getTime();
  return rowAt < mintedAt || (rowAt === mintedAt && row.id < minted.id);
}

/**
 * Ends the sessions minted earlier to replace the same cookie: two step-ups from one browser at once
 * each mint one, and only one `Set-Cookie` survives in the browser.
 */
async function endEarlierSiblings(
  context: Pick<AuthContext, "adapter">,
  minted: { id: string; userId: string; updatedAt: Date | string },
  lineage: string,
): Promise<void> {
  const siblings = await context.adapter.findMany<{ id: string; updatedAt: Date | string }>({
    model: "session",
    where: [
      { field: "userId", value: minted.userId },
      { field: REPLACED_SESSION_FIELD, value: lineage },
    ],
    limit: EVERY_ROW,
  });

  // Every hook keeps the latest it sees and ends the rest, its own row included: the last hook to run
  // sees every sibling whatever order the inserts landed in, so exactly one stands.
  const rows = siblings.some((row) => row.id === minted.id) ? siblings : [...siblings, minted];
  const latest = rows.reduce((kept, row) => (mintedBefore(kept, row) ? row : kept));
  // Its own row ends only where a later mint was inserted first, and the browser may keep this
  // response's cookie all the same: that fails closed, as a sign-in asked again.
  const earlier = rows.filter((row) => row.id !== latest.id).map((row) => row.id);
  if (earlier.length === 0) return;

  await context.adapter.deleteMany({ model: "session", where: [{ field: "id", operator: "in", value: earlier }] });
}

/**
 * Ends the session the request's cookie named once a sign-in has minted its successor: a step-up
 * would otherwise leave the session it replaced alive beside the new one.
 */
export async function endReplacedSession(
  ctx: GenericEndpointContext,
  minted: { id: string; token: string; userId: string; updatedAt: Date | string },
): Promise<void> {
  const replaced = await replacedToken(ctx);
  if (replaced === null || replaced === minted.token) return;

  try {
    await ctx.context.internalAdapter.deleteSession(replaced);
    await endEarlierSiblings(ctx.context, minted, await lineageOf(replaced, ctx.context.secret));
  } catch (failed) {
    // Logged and left: the new session is committed, and failing the sign-in now would strand it
    // without its cookie while the replaced one stayed alive anyway.
    logger.error("auth.session_rotation_failed", undefined, {
      name: failed instanceof Error ? failed.name : "unknown",
    });
  }
}

/**
 * The send gate's verdict, asked again of the account a session is about to be minted for: a code
 * mailed before a ban, and every passkey, would otherwise sign in past it. Only `admitted` mints.
 */
export async function refuseUnadmitted(ctx: GenericEndpointContext, userId: string): Promise<Date> {
  const account = await ctx.context.internalAdapter.findUserById(userId);
  // Inside a registration's transaction the before hook's read decides, never a second round trip.
  const carried = carriedEnrolmentRead(ctx, userId);
  // Answered to date the session it admits: taken before the read is sent, so a ban the read missed ends it.
  const sentAt = carried?.sentAt ?? now();
  const verdict = account === null ? "failed" : carried === undefined ? await mayReceiveSignIn(account.email) : signInVerdictOf(carried.signIn);
  if (verdict === "admitted") return sentAt;

  // Worded where the ceremony starts (`fl_frontend/src/features/auth/passkeyAnswers.ts`); a failed
  // read is the backend's and not the person's, so it answers as a retry would.
  if (verdict === "failed") throw APIError.fromStatus("SERVICE_UNAVAILABLE");
  // The browser reads this body, so a ban and an address holding nothing answer it byte for byte alike.
  throw new APIError("FORBIDDEN", { code: SIGN_IN_REFUSED, message: "No sign-in is admitted for this address." });
}
