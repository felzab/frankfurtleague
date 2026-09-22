import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { redactedParameterNames } from "@/core/edgeRedaction.ts";

import { einladungsLink } from "./einladungLink.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

/** Every module that mints an invite link, read as source: which variable a call site reads is nothing a render shows. */
const MINTER = ["actions.ts"].map((relativ) => ({
  name: relativ,
  source: readFileSync(path.resolve(import.meta.dirname, relativ), "utf8"),
}));

describe("the invite link the mail carries", () => {
  it("puts the token on the origin it was handed, under the registration page's path", () => {
    assert.equal(einladungsLink(ORIGIN, "beispiel-eins"), `${ORIGIN}/registrierung?token=beispiel-eins`);
  });

  /* A token is a credential the backend compares byte for byte, and an unencoded `&` or `#` in one
     would end the parameter early and hand the page a token nothing matches. */
  it("percent-encodes the token, so nothing inside it can end the parameter", () => {
    assert.equal(einladungsLink(ORIGIN, "a b&c=d?e/f#g"), `${ORIGIN}/registrierung?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  /* The name is the whole of what the edge matches on (`docs/logging/spec.md :: L11`), so a link
     spelled with any other parameter writes the credential into the access line and the referer. */
  it("names a parameter the edge's own redaction map replaces", () => {
    const redacted = redactedParameterNames();
    const name = /\?(\w+)=/.exec(einladungsLink(ORIGIN, "beispiel-eins"))?.[1] ?? "";

    assert.ok(redacted.length > 0, "the edge's map was read as replacing no parameter at all, so this case compares nothing");
    assert.ok(redacted.includes(name), `the link is spelled \`${name}=\`, which the edge does not redact`);
  });

  /* A link built on the published origin sends a reader of the local stack into production, and the
     two origins are separate settings for the reason `docs/frontend/spec.md :: I186` gives. */
  it("is minted on the configured origin by every module that mints one, and on the published one by none", () => {
    for (const { name, source } of MINTER) {
      assert.match(source, /einladungsLink\(origin/, `${name} mints its link on something other than the origin it read`);
      assert.match(source, /frontend_config\.AUTH_URL/, `${name} takes its origin from somewhere other than the configuration`);
      // The import rather than the identifier: a comment naming the published origin to refuse it is
      // not a use of it.
      assert.doesNotMatch(source, /^import \{[^}]*\bSITE_URL\b/m, `${name} imports the published origin`);
    }
  });
});
