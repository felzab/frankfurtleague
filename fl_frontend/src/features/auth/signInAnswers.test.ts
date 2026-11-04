import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy.ts";
import { describeCeremonyRefusal } from "@/features/auth/passkeyAnswers.ts";

const { refusal } = COPY.signIn;

describe("a passkey ceremony's refusal", () => {
  it("words a barred address as one holding no record, so the ban list cannot be probed", () => {
    expect(describeCeremonyRefusal({ code: "SIGN_IN_BARRED" })).toBe(refusal.noRecord);
    expect(describeCeremonyRefusal({ code: "SIGN_IN_HOLDS_NOTHING" })).toBe(refusal.noRecord);
  });
});
