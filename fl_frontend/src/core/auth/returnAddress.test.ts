import { describe, expect, it } from "vitest";

import { allowedReturnAddress, withReturnAddress } from "./returnAddress.ts";

describe("the addresses a sign-in may return to", () => {
  it.each(["/area", "/account", "/admin", "/area/admin/administratoren", "/admin/spielorte", "/erasure?token=Ab3-x_9"])("holds %s", (asked) => {
    expect(allowedReturnAddress(asked)).toBe(asked);
  });

  it.each([
    ["another site", "https://example.com/area"],
    ["a protocol-relative address", "//example.com/area"],
    ["a backslash a browser reads as a slash", "/\\example.com/area"],
    ["an escaped separator", "/area%2F..%2Fadmin"],
    ["an escaped slash ahead of the host", "/%2Fexample.com"],
    ["a dot segment", "/area/../impressum"],
    ["a page outside the three", "/impressum"],
    ["a query on an area's page", "/account?next=https://example.com/"],
    ["a deletion link without its token", "/erasure"],
    ["a line break past the address", "/area\n"],
    ["nothing", ""],
  ])("refuses %s", (_, asked) => {
    expect(allowedReturnAddress(asked)).toBe(null);
  });

  it("carries an allowed address on a path as one encoded parameter, and leaves the path alone otherwise", () => {
    expect(withReturnAddress("/signin", "/erasure?token=abc")).toBe("/signin?return=%2Ferasure%3Ftoken%3Dabc");
    expect(withReturnAddress("/signin", "//example.com/area")).toBe("/signin");
    expect(withReturnAddress("/signin", null)).toBe("/signin");
  });
});
