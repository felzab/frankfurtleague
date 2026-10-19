import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertRedactedAtTheEdge } from "@/core/edgeRedaction.ts";
import { registerDoubles } from "@/core/exportingModule.ts";

registerDoubles();

const { SPIEL_BESTAETIGUNG_PATH, spielBestaetigungsLink } = await import("./bestaetigungLink.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

describe("the fixture confirmation's link", () => {
  it("puts the token on the origin it was handed, under the confirmation page's path", () => {
    assert.equal(spielBestaetigungsLink(ORIGIN, "beispiel-eins"), `${ORIGIN}/bestaetigung/spiel?token=beispiel-eins`);
  });

  /* `docs/frontend/spec.md :: I186`: the link stands on the serving origin as the close does, so a configured
     trailing slash or path reaches neither, and a value that is no URL composes no message at all. */
  it("stands on the origin `mailOrigin` makes of the configured value", () => {
    assert.equal(spielBestaetigungsLink(`${ORIGIN}/irgendwo/`, "t"), `${ORIGIN}${SPIEL_BESTAETIGUNG_PATH}?token=t`);
    assert.throws(() => spielBestaetigungsLink("/bestaetigung", "t"), /absolute origin/);
  });

  /* A token is a credential the backend compares byte for byte, and an unencoded `&` or `#` in one would end
     the parameter early and hand the page a token nothing matches. */
  it("percent-encodes the token, so nothing inside it can end the parameter", () => {
    assert.equal(spielBestaetigungsLink(ORIGIN, "a b&c=d?e/f#g"), `${ORIGIN}${SPIEL_BESTAETIGUNG_PATH}?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  it("names a parameter the edge's own redaction map replaces", () => {
    assertRedactedAtTheEdge(spielBestaetigungsLink(ORIGIN, "beispiel-eins"));
  });
});
