import { describe, expect, it } from "vitest";

import { SignInAddressSchema } from "./schemas";

describe("an address a person will sign in at", () => {
  /* The API takes every atext character and the sign-in library does not: a grant there admits nobody, and a change onto
     it locks its person out, the sign-in answering as sent and no code ever coming. */
  it("refuses an address the sign-in library refuses, and takes a plain one", () => {
    expect(SignInAddressSchema.safeParse("a~b@example.net").success).toBe(false);
    expect(SignInAddressSchema.safeParse("anna@example.net").success).toBe(true);
  });
});
