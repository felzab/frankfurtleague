import { COPY } from "@/core/copy";
import { CODE_FAILURE_WINDOW_HOURS } from "@/core/signInCode";

import type { Copy } from "@/core/copy";

const { refusal } = COPY.signIn;

/**
 * Every sentence the sign-in's send and its code route answer with a reason, as the catalogue holds it: the
 * route and the bot check read these same entries, so a sentence one of them answers is found here.
 */
const ANTWORTEN: readonly Copy[] = [
  refusal.codeWrong,
  refusal.codeExpired,
  refusal.codeTooOften,
  refusal.addressTooOften(CODE_FAILURE_WINDOW_HOURS),
  refusal.codeUsedUp,
  refusal.noRecord,
  ...Object.values(COPY.shared.botCheck),
  COPY.signIn.botCheckNotLoaded,
];

/**
 * The catalogue's entry for a sentence the server or the bot check answered, found by its words, so the page
 * renders the catalogue's own text; any other answer, a retry no reason names among them, is the shared
 * failure line.
 */
export function signInAnswer(satz: string | undefined): Copy {
  return ANTWORTEN.find((antwort) => antwort === satz) ?? COPY.shared.failure.unexpected;
}
