import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, it } from "node:test";

import { buildContentSecurityPolicy, PRERENDERED_INLINE_SCRIPT_HASHES } from "./csp.ts";

const directives = (policy: string) =>
  Object.fromEntries(
    policy.split("; ").map((part) => {
      const [name, ...values] = part.split(" ");
      return [name, values.join(" ")];
    }),
  );

describe("buildContentSecurityPolicy", () => {
  it("embeds the caller's nonce in script-src", () => {
    assert.ok(directives(buildContentSecurityPolicy("abc123"))["script-src"]?.includes("'nonce-abc123'"));
  });

  it("carries every prerendered inline-script hash in script-src", () => {
    const scriptSrc = directives(buildContentSecurityPolicy("n"))["script-src"] ?? "";
    for (const hash of PRERENDERED_INLINE_SCRIPT_HASHES) assert.ok(scriptSrc.includes(hash), `script-src is missing ${hash}`);
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

/**
 * The guard rail for the hash list above. `pnpm verify` runs `pnpm build` before `pnpm test`, so the
 * prerendered HTML is always present and current when this runs.
 *
 * It exists because the failure it catches is silent: bump `next-themes` or React, the inline script
 * body changes, its hash changes, and under an enforcing policy the browser blocks it. No error, no
 * log line -- just a flash of the wrong theme. This turns that into a red build with the exact fix.
 */
const PRERENDER_DIR = join(import.meta.dirname, "../../.next/server/app");

function collectHtmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectHtmlFiles(full);
    return entry.isFile() && entry.name.endsWith(".html") ? [full] : [];
  });
}

/** Inline `<script>` only -- anything with a `src` is an external file, covered by `'self'`. */
const INLINE_SCRIPT = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

describe("prerendered inline script hashes", () => {
  let htmlFiles: string[] = [];
  try {
    htmlFiles = collectHtmlFiles(PRERENDER_DIR);
  } catch {
    /* no build output -- handled below */
  }

  it("finds prerendered HTML to check", { skip: htmlFiles.length === 0 ? "run `pnpm build` first (pnpm verify does)" : false }, () => {
    assert.ok(htmlFiles.length > 0);
  });

  /**
   * RSC flight data, inlined by Next. Unlike the framework scripts above these are derived from page
   * *content*, so their hashes change on any copy edit -- hashing them would be a maintenance trap.
   * They only appear on fully-static pages; the 19 routes that `await connection()` stream their
   * flight data at request time, where it picks up the nonce. See R3b-S9.1b.
   */
  const isFlightData = (body: string) => body.startsWith("self.__next_f") || body.startsWith("(self.__next_f");
  const FLIGHT_DATA_PAGES = ["_global-error.html", "_not-found.html"];

  it("has a hash for every framework inline script in the prerendered shells", { skip: htmlFiles.length === 0 }, () => {
    const found = new Map<string, { body: string; pages: Set<string> }>();

    for (const file of htmlFiles) {
      const html = readFileSync(file, "utf8");
      for (const [, body] of html.matchAll(INLINE_SCRIPT)) {
        if (isFlightData(body)) continue;
        const hash = `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
        const entry = found.get(hash) ?? { body, pages: new Set<string>() };
        entry.pages.add(file.slice(PRERENDER_DIR.length + 1));
        found.set(hash, entry);
      }
    }

    const allowed = new Set<string>(PRERENDERED_INLINE_SCRIPT_HASHES);
    const unlisted = [...found].filter(([hash]) => !allowed.has(hash));

    assert.deepEqual(
      unlisted.map(([hash]) => hash),
      [],
      unlisted
        .map(
          ([hash, { body, pages }]) =>
            `\n\nAn inline script in the prerendered HTML has no hash in PRERENDERED_INLINE_SCRIPT_HASHES.` +
            `\nUnder an enforcing CSP the browser will BLOCK it.` +
            `\n\n  add to src/core/csp.ts:  ${hash},` +
            `\n  script starts:           ${body.slice(0, 70).replace(/\s+/g, " ")}` +
            `\n  seen on:                 ${[...pages].slice(0, 3).join(", ")}${pages.size > 3 ? ` (+${pages.size - 3} more)` : ""}` +
            `\n\nThis normally means a dependency upgrade changed a script body. Confirm the script is` +
            `\nsomething you expect (next-themes' theme setter, React's timing helper), then replace the` +
            `\nstale entry with the hash above -- do not simply append it, or the list rots.`,
        )
        .join(""),
    );
  });

  /**
   * The known, accepted residual for R3b-S9.1b, pinned so it cannot quietly grow. If a route stops
   * being dynamic its flight data starts getting prerendered too, and the enforcing flip would then
   * break a page nobody thought about. This fails the build the moment that happens.
   */
  it("confines inlined flight data to the two static error pages", { skip: htmlFiles.length === 0 }, () => {
    const offenders = htmlFiles
      .filter((file) => !FLIGHT_DATA_PAGES.includes(basename(file)))
      .filter((file) => [...readFileSync(file, "utf8").matchAll(INLINE_SCRIPT)].some(([, body]) => isFlightData(body)))
      .map((file) => file.slice(PRERENDER_DIR.length + 1));

    assert.deepEqual(
      offenders,
      [],
      [
        "",
        "",
        `Inlined RSC flight data now appears on ${offenders.length} page(s) beyond the known static error pages:`,
        `  ${offenders.join(", ")}`,
        "",
        "Those scripts carry no nonce and cannot practically be hashed (their content changes on every",
        "edit), so an ENFORCING CSP would block them and that page would not hydrate.",
        "",
        "Either restore the route's dynamic rendering -- an `await connection()` in the page, per",
        "CLAUDE.md §9 A1 -- so its flight data is streamed per request and gets the nonce, or accept it",
        "and extend FLIGHT_DATA_PAGES here plus the residual note on ledger row R3b-S9.1b.",
      ].join("\n"),
    );
  });

  it("carries no stale hash for a script that is no longer emitted", { skip: htmlFiles.length === 0 }, () => {
    const emitted = new Set(
      htmlFiles.flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(INLINE_SCRIPT)]
          .filter(([, body]) => !isFlightData(body))
          .map(([, body]) => `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`),
      ),
    );

    const stale = PRERENDERED_INLINE_SCRIPT_HASHES.filter((hash) => !emitted.has(hash));
    assert.deepEqual(
      stale,
      [],
      `\n\nPRERENDERED_INLINE_SCRIPT_HASHES contains ${stale.length} hash(es) matching no inline script in any` +
        `\nprerendered page: ${stale.join(", ")}` +
        `\n\nA hash that matches nothing grants nothing, so this is not a security hole -- but it means the` +
        `\nlist is drifting. Remove the stale entry from src/core/csp.ts.`,
    );
  });
});
