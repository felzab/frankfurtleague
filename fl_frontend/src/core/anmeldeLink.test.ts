import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

const EDGE_CONFIG = path.resolve(import.meta.dirname, "..", "..", "..", "nginx", "prod.conf");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

// Replaced at the module boundary: the real module refuses an environment no test run supplies, and
// a value read from `process.env` here would make the case depend on the shell that started it.
const CONFIG_DOUBLE = `export const frontend_config = { AUTH_URL: "${ORIGIN}" };`;

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { ANMELDE_BESTAETIGEN_PATH, buildAnmeldeLink } = await import("./anmeldeLink.ts");

/**
 * The parameter names the edge replaces in its access line, read off the map rather than retyped:
 * two literals agreeing is what let three modules drift apart in the first place.
 */
function redactedParameterNames(): string[] {
  const config = readFileSync(EDGE_CONFIG, "utf8");
  const block = config.slice(config.indexOf("map $request_uri $credential_free_uri {"));
  const arms = block.slice(0, block.indexOf("}"));
  const alternations = [...arms.matchAll(/\(([a-z]+(?:\|[a-z]+)+)\)/g)].flatMap((match) => (match[1] ?? "").split("|"));

  return [...new Set(alternations)];
}

describe("the sign-in link the mail carries", () => {
  it("puts the token on the configured origin, under the page whose button spends it", () => {
    assert.equal(buildAnmeldeLink("beispiel-eins"), `${ORIGIN}${ANMELDE_BESTAETIGEN_PATH}?token=beispiel-eins`);
    assert.equal(ANMELDE_BESTAETIGEN_PATH, "/signin/bestaetigen");
  });

  /* Better Auth compares the token byte for byte, and an unencoded `&` or `#` in one would end the
     parameter early and hand the verification a token nothing matches. */
  it("percent-encodes the token, so nothing inside it can end the parameter", () => {
    assert.equal(buildAnmeldeLink("a b&c=d?e/f#g"), `${ORIGIN}${ANMELDE_BESTAETIGEN_PATH}?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  /* The name is the whole of what the edge matches on (`docs/logging/spec.md :: L11`), so a link
     spelled with any other parameter writes the credential into the access line and the referer. */
  it("names a parameter the edge's own redaction map replaces", () => {
    const redacted = redactedParameterNames();
    const name = /\?(\w+)=/.exec(buildAnmeldeLink("beispiel-eins"))?.[1] ?? "";

    assert.ok(redacted.length > 0, "the edge's map was read as replacing no parameter at all, so this case compares nothing");
    assert.ok(redacted.includes(name), `the link is spelled \`${name}=\`, which the edge does not redact`);
  });
});
