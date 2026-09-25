import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactedParameterNames } from "@/core/edgeRedaction.ts";

import { bestaetigungsLink } from "./bestaetigungLink.ts";

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

describe("the confirmation link every minter spells", () => {
  it("puts the token on the origin it was handed, under the confirmation page's path", () => {
    assert.equal(bestaetigungsLink(ORIGIN, "beispiel-eins"), `${ORIGIN}/bestaetigung/kontakt?token=beispiel-eins`);
  });

  /* A token is a credential the backend compares byte for byte, and an unencoded `&` or `#` in one
     would end the parameter early and hand the page a token nothing matches. */
  it("percent-encodes the token, so nothing inside it can end the parameter", () => {
    assert.equal(bestaetigungsLink(ORIGIN, "a b&c=d?e/f#g"), `${ORIGIN}/bestaetigung/kontakt?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  /* The name is the whole of what the edge matches on (`docs/logging/spec.md :: L11`), so a link
     spelled with any other parameter writes the credential into the access line and the referer. */
  it("names a parameter the edge's own redaction map replaces", () => {
    const redacted = redactedParameterNames();
    const name = /\?(\w+)=/.exec(bestaetigungsLink(ORIGIN, "beispiel-eins"))?.[1] ?? "";

    assert.ok(redacted.length > 0, "the edge's map was read as replacing no parameter at all, so this case compares nothing");
    assert.ok(redacted.includes(name), `the link is spelled \`${name}=\`, which the edge does not redact`);
  });
});
