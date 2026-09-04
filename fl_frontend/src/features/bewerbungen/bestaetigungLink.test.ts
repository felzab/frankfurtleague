import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { SITE_URL } from "@/core/brand.ts";

import { bestaetigungsLink } from "./bestaetigungLink.ts";

const EDGE_CONFIG = path.resolve(import.meta.dirname, "..", "..", "..", "..", "nginx", "prod.conf");

/**
 * The parameter names the edge replaces in its access line, read off the map rather than retyped:
 * two literals agreeing is what let three modules drift apart in the first place.
 */
function redactedParameterNames(): string[] {
  const ab = readFileSync(EDGE_CONFIG, "utf8");
  const block = ab.slice(ab.indexOf("map $request_uri $credential_free_uri {"));
  const bis = block.slice(0, block.indexOf("}"));
  const alternationen = [...bis.matchAll(/\(([a-z]+(?:\|[a-z]+)+)\)/g)].flatMap((treffer) => (treffer[1] ?? "").split("|"));

  return [...new Set(alternationen)];
}

describe("the confirmation link every minter spells", () => {
  it("puts the token on the site's own origin, under the confirmation page's path", () => {
    assert.equal(bestaetigungsLink("beispiel-eins"), `${SITE_URL}/bestaetigung?token=beispiel-eins`);
  });

  /* A token is a credential the backend compares byte for byte, and an unencoded `&` or `#` in one
     would end the parameter early and hand the page a token nothing matches. */
  it("percent-encodes the token, so nothing inside it can end the parameter", () => {
    assert.equal(bestaetigungsLink("a b&c=d?e/f#g"), `${SITE_URL}/bestaetigung?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  /* The name is the whole of what the edge matches on (`docs/logging/spec.md :: L11`), so a link
     spelled with any other parameter writes the credential into the access line and the referer. */
  it("names a parameter the edge's own redaction map replaces", () => {
    const redigiert = redactedParameterNames();
    const name = /\?(\w+)=/.exec(bestaetigungsLink("beispiel-eins"))?.[1] ?? "";

    assert.ok(redigiert.length > 0, "the edge's map was read as replacing no parameter at all, so this case compares nothing");
    assert.ok(redigiert.includes(name), `the link is spelled \`${name}=\`, which the edge does not redact`);
  });
});
