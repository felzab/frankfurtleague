import { ADDRESS_ATTEMPTS_EXHAUSTED } from "@/core/auth/codeRefusal";
import { COPY } from "@/core/copy";
import { SIGN_IN_REFUSED } from "@/core/passkeyRefusal";

import { refusalCode, refusalStatus } from "./passkeyAnswers";

import type { Copy } from "@/core/copy";

const { refusal } = COPY.signIn;

/**
 * The library's refusals of a typed code by their code. Each reaches an address holding an account and one holding
 * none alike, so none of them names which it met; the mint's, met only past a right code, is one code for a barred
 * address and one holding no record. A code never mailed, one already spent, one a newer mail replaced and one expired
 * are no longer valid alike, and every limit on tries is the one shared line, whatever it counted.
 */
const CODE_REFUSALS: ReadonlyMap<string, Copy> = new Map([
  ["INVALID_OTP", refusal.codeWrong],
  ["OTP_EXPIRED", refusal.codeWrong],
  ["TOO_MANY_ATTEMPTS", COPY.shared.failure.tooManyAttempts],
  [ADDRESS_ATTEMPTS_EXHAUSTED, COPY.shared.failure.tooManyAttempts],
  [SIGN_IN_REFUSED, refusal.noRecord],
]);

/** The edge's own rate refusal, which checked nothing and carries none of the library's codes. */
const TOO_MANY_REQUESTS = 429;

/**
 * What the code check's refusal tells the reader: its code's sentence, else what its status alone can say. A backend
 * that did not answer the mint is an outage, the shared failure line, though it spent the code: retyping it meets the
 * code no longer valid.
 */
export function codeRefusal(error: unknown): Copy {
  const worded = CODE_REFUSALS.get(refusalCode(error) ?? "");
  if (worded !== undefined) return worded;

  if (refusalStatus(error) === TOO_MANY_REQUESTS) return COPY.shared.failure.tooManyAttempts;
  return COPY.shared.failure.unexpected;
}
