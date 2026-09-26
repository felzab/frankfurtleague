import "server-only";

import { createHash } from "node:crypto";

import { mailboxKey } from "./emailAddress";

// Beside `fl_frontend/src/core/mail.ts` rather than inside it: the fan-outs' tests double that module
// whole, and this key is what they assert on, so it has to stay the real one.
/**
 * The caller's scope, then the recipient's mailbox: the provider refuses a key reused over another
 * payload, so a key without it refuses a fan-out's later addresses and an address corrected in the window.
 */
export function mailIdempotencyKey(scope: readonly string[], address: string): string {
  // A digest rather than the address, which would carry it into a second place and push the key past
  // the provider's 256 characters.
  return [...scope, createHash("sha256").update(mailboxKey(address)).digest("hex")].join("_");
}
