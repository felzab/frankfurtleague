import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy.ts";
import { MENSCH_BESTAETIGEN } from "@/core/turnstileToken.ts";
import { describeCeremonyRefusal, OHNE_EINTRAG } from "@/features/auth/passkeyAnswers.ts";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal.ts";

import { codeRefusal, signInAnswer } from "./signInAnswers.ts";

const { refusal } = COPY.signIn;

describe("a bot check's answer read back as the catalogue's words", () => {
  it.each([
    ["a token the check refused", MENSCH_BESTAETIGEN],
    ["a disturbed check", COPY.shared.botCheck.disrupted],
    ["a check not yet done", COPY.shared.botCheck.notReady],
    ["a check that did not load", COPY.shared.botCheck.notLoaded],
  ])("finds %s", (_, satz) => {
    expect(signInAnswer(satz)).toBe(satz);
  });

  it("answers a retry no reason names, and no answer at all, with the shared failure line", () => {
    expect(signInAnswer(VERSUCHE_ES_ERNEUT_SATZ)).toBe(COPY.shared.failure.unexpected);
    expect(signInAnswer(undefined)).toBe(COPY.shared.failure.unexpected);
  });
});

describe("a typed code's refusal, as the library's client answers it", () => {
  it.each([
    ["a wrong code", { code: "INVALID_OTP", status: 400 }, refusal.codeWrong],
    ["an expired code", { code: "OTP_EXPIRED", status: 400 }, refusal.codeExpired],
    ["a code tried too often", { code: "TOO_MANY_ATTEMPTS", status: 403 }, refusal.codeTooOften],
    ["an address tried too often", { code: "ADDRESS_ATTEMPTS_EXHAUSTED", status: 429 }, refusal.addressTooOften],
    ["a barred address", { code: "SIGN_IN_BARRED", status: 403 }, OHNE_EINTRAG],
    ["an address holding nothing", { code: "SIGN_IN_HOLDS_NOTHING", status: 403 }, OHNE_EINTRAG],
    ["the mint's outage past a spent code", { status: 503 }, refusal.codeUsedUp],
    ["the edge's own rate refusal", { status: 429 }, COPY.shared.failure.tooManyAttempts],
    ["any other answer", { status: 500 }, COPY.shared.failure.unexpected],
    ["a request that never left", new TypeError("Failed to fetch"), COPY.shared.failure.unexpected],
  ])("words %s", (_, error, satz) => {
    expect(codeRefusal(error)).toBe(satz);
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
