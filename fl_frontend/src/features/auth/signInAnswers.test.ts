import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy.ts";
import { CODE_FAILURE_WINDOW_HOURS } from "@/core/signInCode.ts";
import { MENSCH_BESTAETIGEN } from "@/core/turnstileToken.ts";
import { describeCeremonyRefusal, OHNE_EINTRAG } from "@/features/auth/passkeyAnswers.ts";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal.ts";

import { signInAnswer } from "./signInAnswers.ts";

const { abgelehnt, pruefungNichtGeladen } = COPY.anmeldung;

describe("a sign-in answer read back as the catalogue's words", () => {
  // Each sentence the code route, the send's bot check or the widget can answer with a reason.
  it.each([
    ["a wrong code", abgelehnt.codeFalsch],
    ["an expired code", abgelehnt.codeAbgelaufen],
    ["a code tried too often", abgelehnt.codeZuOft],
    ["an address tried too often", abgelehnt.adresseZuOft(CODE_FAILURE_WINDOW_HOURS)],
    ["a spent code", abgelehnt.codeVerbraucht],
    ["an address that may not sign in", OHNE_EINTRAG],
    ["a token the check refused", MENSCH_BESTAETIGEN],
    ["a disturbed check", COPY.shared.pruefung.gestoert],
    ["a check not yet done", COPY.shared.pruefung.nichtFertig],
    ["a check that did not load", pruefungNichtGeladen],
  ])("finds %s", (_, satz) => {
    expect(signInAnswer(satz)).toBe(satz);
  });

  it("answers a retry no reason names, and no answer at all, with the shared failure line", () => {
    expect(signInAnswer(VERSUCHE_ES_ERNEUT_SATZ)).toBe(COPY.shared.fehler.unerwartet);
    expect(signInAnswer(undefined)).toBe(COPY.shared.fehler.unerwartet);
  });
});

describe("a passkey ceremony's refusal", () => {
  it("words a barred address as one holding no record, so the ban list cannot be probed", () => {
    expect(describeCeremonyRefusal({ code: "SIGN_IN_BARRED" })).toBe(abgelehnt.ohneEintrag);
    expect(describeCeremonyRefusal({ code: "SIGN_IN_HOLDS_NOTHING" })).toBe(abgelehnt.ohneEintrag);
  });

  it("words a cancelled or unknown refusal with the shared failure line", () => {
    expect(describeCeremonyRefusal(new Error("NotAllowedError"))).toBe(COPY.shared.fehler.unerwartet);
  });
});
