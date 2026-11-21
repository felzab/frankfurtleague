import "server-only";

import { APIError } from "better-auth/api";

import { isPasskeyTouch } from "./sessionStamps";

import type { DBTransactionAdapter } from "better-auth";
import type { SignInRecords } from "../signInGate";
import type { SessionStamps } from "./sessionStamps";

// A ceiling nothing else supplies: one session that passed the assertion can enrol without limit. Five, because an
// administrator carries several devices, and a second passkey enrolled in advance keeps recovery off the Atlas console.
export const PASSKEY_LIMIT = 5;

/**
 * A barred address enrols nothing, whatever it holds: its session is one a ban's ending missed or a
 * mint raced, and a passkey would outlive both.
 */
export function refuseBarred(signIn: SignInRecords): void {
  if (signIn.barred) throw APIError.fromStatus("NOT_FOUND");
}

/**
 * An address holding no grant enrols nothing: a person's first passkey would outrank their mailbox for good, every act
 * on the touch's list asking it, so whoever enrolled it first, an intruder too, keeps the account.
 */
export function refuseWithoutGrant(signIn: SignInRecords): void {
  if (signIn.admin_tier === null) throw APIError.fromStatus("NOT_FOUND");
}

/**
 * The gate's answer for the caller, read in the registration's before hook and when that read was sent, carried on
 * the endpoint's context into its transaction, where the mint of a set-up that signs in asks the gate of it rather
 * than make a backend round trip holding the transaction open.
 */
export type EnrolmentRead = {
  readonly userId: string;
  readonly signIn: SignInRecords;
  readonly sentAt: Date;
};

/** The context key the carried read travels under; a string, the library merging no symbol key. */
export const ENROLMENT_READ = "flEnrolmentRead";

export function carriedEnrolmentRead(ctx: object | undefined, userId: string): EnrolmentRead | undefined {
  const read: unknown = ctx === undefined ? undefined : Reflect.get(ctx, ENROLMENT_READ);
  if (typeof read !== "object" || read === null) return undefined;

  return Reflect.get(read, "userId") === userId ? (read as EnrolmentRead) : undefined;
}

/**
 * Every condition an enrolment meets past the library's `freshAge`, on both arms: the plugin gates its two
 * registration endpoints on that and on nothing else. The touch is judged as of `touchAt`, now where it is
 * `undefined`: the options request judges it now, and the verify call as of that ceremony's options, so the browser's
 * own prompt, a cross-device one by QR code among them, never runs the touch's window down. What bounds the prompt is
 * the library's `freshAge`, which holds the verify call to the session's creation (`FRESH_SIGN_IN_SECONDS`): after a
 * touch, whose options fall inside `PASSKEY_TOUCH_SECONDS`, that leaves the prompt the difference of the two at least,
 * and a prompt running past it is refused as a sign-in too old.
 */
export async function refuseEnrolment(
  adapter: DBTransactionAdapter,
  userId: string,
  caller: SessionStamps | null,
  touchAt: Date | undefined,
): Promise<void> {
  // Every refusal below is the default-deny net's own answer, so an enrolment the page never offers
  // names no surface either.
  if (caller === null) throw APIError.fromStatus("NOT_FOUND");

  const held = await adapter.count({ model: "passkey", where: [{ field: "userId", value: userId }] });

  // An administrator's first passkey is added on a fresh sign-in by either factor, their mailed code among them; every
  // later one by the passkey touch alone, or a stolen mailbox would put its own authenticator beside the holder's.
  if (held > 0 && !isPasskeyTouch(caller, touchAt)) throw APIError.fromStatus("NOT_FOUND");
  if (held >= PASSKEY_LIMIT) throw APIError.fromStatus("NOT_FOUND");
}
