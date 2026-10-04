import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { isAPIError } from "better-auth/api";
import { z } from "zod";

import { ADDRESS_ATTEMPTS_EXHAUSTED, forgiveCodeAttempt, readAdmittedSession, signInWithCode } from "@/core/auth";
import { CODE_VALIDITY_MINUTES } from "@/core/authEmail";
import { frontend_config } from "@/core/config";
import { asSignInIdentifier } from "@/core/emailAddress";
import { logger } from "@/core/logging";
import { SIGN_IN_BARRED, SIGN_IN_HOLDS_NOTHING } from "@/core/passkeyRefusal";
import { CODE_FAILURE_WINDOW_HOURS, SIGN_IN_CODE_LENGTH } from "@/core/signInCode";
import { GESPERRT, OHNE_EINTRAG } from "@/features/auth/passkeyAnswers";
import { SignInPayloadSchema } from "@/features/auth/schemas";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal";

import type { NextRequest } from "next/server";

/** What the code step posts: the address the code went to, and the code. No form validates a draft of it. */
const CodeSignInPayloadSchema = SignInPayloadSchema.extend({
  code: z.string().regex(new RegExp(`^\\d{${String(SIGN_IN_CODE_LENGTH)}}$`)),
});

/** One answer for every code the store does not hold: mistyped, expired and swept, already spent, or replaced
 * by a newer mail. A sentence naming one cause alone is false for the others, and each retype is counted. */
const FALSCH = "Der Code stimmt nicht oder gilt nicht mehr. Nimm den Code aus der neuesten E-Mail oder fordere einen neuen an.";

/**
 * The mint's backend did not answer, after the code was already spent: retyping it would meet a wrong
 * code, so the reader is sent for a new one.
 */
const CODE_VERBRAUCHT =
  "Die Anmeldung hat gerade nicht geklappt, und Dein Code ist damit verbraucht. Fordere in ein paar Minuten einen neuen an.";

/**
 * The library's refusals by code. Each reaches an address holding an account and one holding none
 * alike, so none of them names which it met (`docs/frontend/spec.md :: I443`).
 */
const REFUSAL_BY_CODE: Readonly<Record<string, string>> = {
  // A code never mailed and a code already spent are this one too: the row is gone either way.
  INVALID_OTP: FALSCH,
  OTP_EXPIRED: "Der Code ist abgelaufen. Fordere einen neuen an.",
  TOO_MANY_ATTEMPTS: "Zu viele Versuche mit diesem Code. Fordere einen neuen an.",
  [ADDRESS_ATTEMPTS_EXHAUSTED]: `Zu viele Versuche mit dieser Adresse. Melde Dich mit einem Passkey an oder versuche es in ${String(CODE_FAILURE_WINDOW_HOURS)} Stunden wieder.`,
  // The mint's own refusals, met only past a right code, so only the mailbox's holder reads them; the
  // passkey's answers word the same two.
  [SIGN_IN_BARRED]: GESPERRT,
  [SIGN_IN_HOLDS_NOTHING]: OHNE_EINTRAG,
};

/** 200 for every answer this application decided, which is what `postPublicForm` tells an edge's answer apart by. */
const refused = (error: string): NextResponse => NextResponse.json({ success: false, error });

const signedIn = (): NextResponse => NextResponse.json({ success: true });

/**
 * The second tab's answer: signed in, but by the sign-in another tab made, never by this code. A caller
 * confirming a change reads `bereits` as no confirmation at all.
 */
const alreadyIn = (): NextResponse => NextResponse.json({ success: true, bereits: true });

/**
 * Whether the caller already holds a session for this address, made inside one code's window: the
 * second tab of a sign-in another tab finished meets a spent code, and is sent on rather than refused.
 */
async function alreadySignedIn(requestHeaders: Headers, email: string): Promise<boolean | null> {
  let served;
  try {
    // The guards' own read, never the library's: a session they refuse forgives no guess (`docs/frontend/spec.md :: I313`).
    served = await readAdmittedSession(requestHeaders);
  } catch (failed) {
    // The NAME alone: a failure on this path may carry the address the code was typed for.
    logger.error("auth.signed_in_unread", undefined, { error_code: "FE-AUTH-002", name: failed instanceof Error ? failed.name : "unknown" });
    return null;
  }
  if (served === null || asSignInIdentifier(served.user.email) !== email) return false;

  // The code's own window rather than any step-up's, so a confirmation asked of an older session is
  // never answered by the session it confirms.
  const created = new Date(served.session.createdAt).getTime();
  return Number.isFinite(created) && Date.now() - created < CODE_VALIDITY_MINUTES * 60 * 1000;
}

// A route handler and not a server action, for the reason `docs/frontend/spec.md` §1.3 gives.
/**
 * POST alone: nothing a mail gateway or a prefetch fetches spends a code. Its calls run in process,
 * past the library's limiter and path switch, so `fl_frontend/src/core/auth.ts :: withinBound` and
 * this path's edge zones bound them (`docs/frontend/spec.md :: I444`).
 */
export async function POST(request: NextRequest) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return new NextResponse(null, { status: 403 });
  }

  // This SPENDS a credential, so a cross-site post of an attacker's own code would sign the reader
  // into the attacker's account. A browser too old to label its request falls back to the pinned
  // origin, never the caller's.
  if (secFetchSite === null && request.headers.get("origin") !== new URL(frontend_config.AUTH_URL).origin) {
    return new NextResponse(null, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return refused(FALSCH);
  }

  // Answered as a wrong code rather than a malformed request: the field takes digits alone, so only
  // a hand-made request reaches this, and it earns no sentence of its own.
  const parsed = CodeSignInPayloadSchema.safeParse(raw);
  if (!parsed.success) return refused(FALSCH);

  // Folded as the send folded it, so the code row, both per-address bounds and the stored account are
  // one address's (`docs/frontend/spec.md :: I446`).
  const email = asSignInIdentifier(parsed.data.email);
  const requestHeaders = await headers();
  // Held by reference: the attempt's own failure row is kept against this object.
  const body = { email, otp: parsed.data.code };

  try {
    // The answer is dropped whole: it carries the session's own token, and the one copy a browser
    // may hold is the cookie `nextCookies()` writes.

    // No `request`, so the library's own origin check never runs: the pair above stands in for it.
    await signInWithCode(body, requestHeaders);
  } catch (error) {
    // Anything the library did not raise is this application failing: never a wrong code, and never a
    // throw, whose 500 the page words as an answer that was not this application's. The NAME alone,
    // for `alreadySignedIn`'s reason.
    if (!isAPIError(error)) {
      logger.error("auth.code_check_failed", undefined, { error_code: "FE-AUTH-002", name: error instanceof Error ? error.name : "unknown" });
      return refused(VERSUCHE_ES_ERNEUT_SATZ);
    }

    // A refusal no code names is worded as a retry, the one answer that promises nothing it cannot
    // keep; the mint's outage is the exception, its code being spent before the mint was asked.
    const code: unknown = error.body?.code;
    const worded = typeof code === "string" ? REFUSAL_BY_CODE[code] : undefined;
    const sentence = worded ?? (error.status === "SERVICE_UNAVAILABLE" ? CODE_VERBRAUCHT : VERSUCHE_ES_ERNEUT_SATZ);

    if (code === "INVALID_OTP") {
      const signedIn = await alreadySignedIn(requestHeaders, email);
      // Neither a wrong code nor a sign-in can be said, so the retry, and at 200: thrown, the page
      // would word the 500 as an answer that was not this application's.
      if (signedIn === null) return refused(VERSUCHE_ES_ERNEUT_SATZ);
      if (signedIn) {
        await forgiveCodeAttempt(body);
        return alreadyIn();
      }
    }

    return refused(sentence);
  }

  // The session cookie rides this response; the page leaves for the landing that decides the rest.
  return signedIn();
}
