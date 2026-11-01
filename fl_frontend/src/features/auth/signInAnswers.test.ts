import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy.ts";
import { CODE_FAILURE_WINDOW_HOURS } from "@/core/signInCode.ts";
import { MENSCH_BESTAETIGEN } from "@/core/turnstileToken.ts";
import { describeCeremonyRefusal, OHNE_EINTRAG } from "@/features/auth/passkeyAnswers.ts";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal.ts";

import { signInAnswer } from "./signInAnswers.ts";

const { refusal, botCheckNotLoaded } = COPY.signIn;

describe("a sign-in answer read back as the catalogue's words", () => {
  // Each sentence the code route, the send's bot check or the widget can answer with a reason.
  it.each([
    ["a wrong code", refusal.codeWrong],
    ["an expired code", refusal.codeExpired],
    ["a code tried too often", refusal.codeTooOften],
    ["an address tried too often", refusal.addressTooOften(CODE_FAILURE_WINDOW_HOURS)],
    ["a spent code", refusal.codeUsedUp],
    ["an address that may not sign in", OHNE_EINTRAG],
    ["a token the check refused", MENSCH_BESTAETIGEN],
    ["a disturbed check", COPY.shared.botCheck.disrupted],
    ["a check not yet done", COPY.shared.botCheck.notReady],
    ["a check that did not load", botCheckNotLoaded],
  ])("finds %s", (_, satz) => {
    expect(signInAnswer(satz)).toBe(satz);
  });

  it("answers a retry no reason names, and no answer at all, with the shared failure line", () => {
    expect(signInAnswer(VERSUCHE_ES_ERNEUT_SATZ)).toBe(COPY.shared.failure.unexpected);
    expect(signInAnswer(undefined)).toBe(COPY.shared.failure.unexpected);
  });
});

describe("a passkey ceremony's refusal", () => {
  it("words a barred address as one holding no record, so the ban list cannot be probed", () => {
    expect(describeCeremonyRefusal({ code: "SIGN_IN_BARRED" })).toBe(refusal.noRecord);
    expect(describeCeremonyRefusal({ code: "SIGN_IN_HOLDS_NOTHING" })).toBe(refusal.noRecord);
  });

  it("words a cancelled or unknown refusal with the shared failure line", () => {
    expect(describeCeremonyRefusal(new Error("NotAllowedError"))).toBe(COPY.shared.failure.unexpected);
  });
});
