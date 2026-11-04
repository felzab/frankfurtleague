import { ADDRESS_ATTEMPTS_EXHAUSTED } from "@/core/auth/codeRefusal";
import { COPY } from "@/core/copy";
import { SIGN_IN_REFUSED } from "@/core/passkeyRefusal";

import { refusalCode, refusalStatus } from "./passkeyAnswers";

import type { Copy } from "@/core/copy";

const { refusal } = COPY.signIn;

/**
 * Every sentence the bot check answers the send with, as the catalogue holds it, so a sentence the check answers is
 * found here.
 */
const BOT_CHECK_ANSWERS: readonly Copy[] = Object.values(COPY.shared.botCheck);

/**
 * The catalogue's entry for a sentence the bot check answered, found by its words, so the page renders the catalogue's
 * own text; any other answer is the shared failure line.
 */
export function signInAnswer(satz: string | undefined): Copy {
  return BOT_CHECK_ANSWERS.find((antwort) => antwort === satz) ?? COPY.shared.failure.unexpected;
}

/**
 * The library's refusals of a typed code by their code. Each reaches an address holding an account and one holding
 * none alike, so none of them names which it met; the mint's, met only past a right code, is one code for a barred
 * address and one holding no record. A code never mailed, one already spent and one a newer mail replaced are
 * `INVALID_OTP` too: the row is gone either way.
 */
const CODE_REFUSALS: ReadonlyMap<string, Copy> = new Map([
  ["INVALID_OTP", refusal.codeWrong],
  ["OTP_EXPIRED", refusal.codeExpired],
  ["TOO_MANY_ATTEMPTS", refusal.codeTooOften],
  [ADDRESS_ATTEMPTS_EXHAUSTED, refusal.addressTooOften],
  [SIGN_IN_REFUSED, refusal.noRecord],
]);

/** The mint's backend did not answer, after the code was already spent: retyping it would meet a wrong code. */
const SERVICE_UNAVAILABLE = 503;

/** The edge's own rate refusal, which checked nothing and carries none of the library's codes. */
const TOO_MANY_REQUESTS = 429;

/** What the code check's refusal tells the reader: its code's sentence, else what its status alone can say. */
export function codeRefusal(error: unknown): Copy {
  const worded = CODE_REFUSALS.get(refusalCode(error) ?? "");
  if (worded !== undefined) return worded;

  const status = refusalStatus(error);
  if (status === SERVICE_UNAVAILABLE) return refusal.codeUsedUp;
  if (status === TOO_MANY_REQUESTS) return COPY.shared.failure.tooManyAttempts;
  return COPY.shared.failure.unexpected;
}
