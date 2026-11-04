import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy.ts";
import { describeCeremonyRefusal } from "@/features/auth/passkeyAnswers.ts";

const { refusal } = COPY.signIn;

describe("a passkey ceremony's refusal", () => {
  it("words the mint's refusal as no sign-in for the address, which a retry would not change", () => {
    expect(describeCeremonyRefusal({ code: "SIGN_IN_REFUSED" })).toBe(refusal.noRecord);
  });
});
