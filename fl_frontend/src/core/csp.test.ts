import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildContentSecurityPolicy } from "./csp.ts";

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values.join(" ")];
    }),
  );

describe("buildContentSecurityPolicy", () => {
  it("embeds the caller's nonce in script-src", () => {
    assert.equal(directives(buildContentSecurityPolicy("abc123"))["script-src"], "'self' 'nonce-abc123'");
  });

  // 'strict-dynamic' voids 'self', and 24 routes ship prerendered shells whose script tags
  // have no nonce. Including it would block every script on every one of them.
  it("omits 'strict-dynamic' so 'self' keeps covering the prerendered chunk scripts", () => {
    const policy = buildContentSecurityPolicy("n");
    assert.ok(!policy.includes("'strict-dynamic'"));
    assert.ok(directives(policy)["script-src"]?.includes("'self'"));
  });

  it("permits neither 'unsafe-eval' nor 'unsafe-inline' for scripts", () => {
    const policy = buildContentSecurityPolicy("n");
    assert.ok(!policy.includes("'unsafe-eval'"));
    assert.ok(!directives(policy)["script-src"]?.includes("'unsafe-inline'"));
  });

  // Tailwind v4 and HeroUI inject styles at runtime, so this one exception stays.
  it("keeps 'unsafe-inline' for styles only", () => {
    assert.ok(directives(buildContentSecurityPolicy("n"))["style-src"]?.includes("'unsafe-inline'"));
  });

  it("restricts connect-src to 'self' so there is no wildcard exfiltration channel", () => {
    assert.equal(directives(buildContentSecurityPolicy("n"))["connect-src"], "'self'");
  });

  // None of these fall back to default-src; base-uri has no fallback at all.
  it("declares the three directives that do not inherit from default-src", () => {
    const parsed = directives(buildContentSecurityPolicy("n"));
    assert.equal(parsed["frame-ancestors"], "'none'");
    assert.equal(parsed["base-uri"], "'self'");
    assert.equal(parsed["object-src"], "'none'");
  });

  it("produces a distinct policy per nonce", () => {
    assert.notEqual(buildContentSecurityPolicy("one"), buildContentSecurityPolicy("two"));
  });
});
