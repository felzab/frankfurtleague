import { ADDRESS_ATTEMPTS_EXHAUSTED, CODE_NOT_ASKED_HERE, isRateRefusal, SIGN_IN_REFUSED } from "@/core/auth/refusalCodes";
import { PUBLIC_COPY } from "@/core/copy/public";
import { COPY } from "@/core/copy/shared";

import { refusalCode } from "./passkeyAnswers";

import type { Copy } from "@/core/copy";
import type { ClientRefusal } from "./passkeyAnswers";

const { refusal } = PUBLIC_COPY.signIn;

/**
 * The library's refusals of a typed code by their code. Each reaches an address holding an account and one holding
 * none alike, so none of them names which it met; the mint's, met only past a right code, is one code for a barred
 * address and one holding no record. A code never mailed, one already spent, one a newer mail replaced, one expired
 * and one this browser did not ask for are no longer valid alike, and every limit on tries is the one shared line,
 * whatever it counted.
 */
const CODE_REFUSALS: ReadonlyMap<string, Copy> = new Map([
  ["INVALID_OTP", refusal.codeWrong],
  ["OTP_EXPIRED", refusal.codeWrong],
  [CODE_NOT_ASKED_HERE, refusal.codeWrong],
  ["TOO_MANY_ATTEMPTS", COPY.shared.failure.tooManyAttempts],
  [ADDRESS_ATTEMPTS_EXHAUSTED, COPY.shared.failure.tooManyAttempts],
  [SIGN_IN_REFUSED, refusal.noRecord],
]);

/**
 * What the code check's refusal tells the reader: its code's sentence, else what its status alone can say. A backend
 * that did not answer the mint is an outage, the shared failure line, though it spent the code: retyping it meets the
 * code no longer valid.
 */
export function codeRefusal(refusal: ClientRefusal): Copy {
  const worded = CODE_REFUSALS.get(refusalCode(refusal) ?? "");
  if (worded !== undefined) return worded;

  if (isRateRefusal(refusal)) return COPY.shared.failure.tooManyAttempts;
  return COPY.shared.failure.unexpected;
}
