import { describe, expect, it } from "vitest";

import { allowedReturnAddress, withReturnAddress } from "./returnAddress.ts";

describe("the addresses a sign-in may return to", () => {
  it.each(["/bereich", "/bereich/konto", "/bereich/admin/administratoren", "/loeschung?token=Ab3-x_9"])("holds %s", (asked) => {
    expect(allowedReturnAddress(asked)).toBe(asked);
  });

  it.each([
    ["another site", "https://example.com/bereich"],
    ["a protocol-relative address", "//example.com/bereich"],
    ["a backslash a browser reads as a slash", "/\\example.com/bereich"],
    ["an escaped separator", "/bereich%2F..%2Fadmin"],
    ["an escaped slash ahead of the host", "/%2Fexample.com"],
    ["a dot segment", "/bereich/../impressum"],
    ["a page outside the two", "/impressum"],
    ["a query on an area's page", "/bereich/konto?next=https://example.com/"],
    ["a deletion link without its token", "/loeschung"],
    ["a line break past the address", "/bereich\n"],
    ["nothing", ""],
  ])("refuses %s", (_, asked) => {
    expect(allowedReturnAddress(asked)).toBe(null);
  });

  it("carries an allowed address on a path as one encoded parameter, and leaves the path alone otherwise", () => {
    expect(withReturnAddress("/signin", "/loeschung?token=abc")).toBe("/signin?return=%2Floeschung%3Ftoken%3Dabc");
    expect(withReturnAddress("/signin", "//example.com/bereich")).toBe("/signin");
    expect(withReturnAddress("/signin", null)).toBe("/signin");
  });
});
