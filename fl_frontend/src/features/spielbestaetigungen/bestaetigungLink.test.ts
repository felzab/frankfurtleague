import { assertRedactedAtTheEdge } from "@/test-support/edgeRedaction.ts";
import { describe, expect, it } from "vitest";

const { SPIEL_BESTAETIGUNG_PATH, spielBestaetigungsLink } = await import("./bestaetigungLink.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

describe("the fixture confirmation's link", () => {
  it("puts the token on the origin it was handed, under the confirmation page's path", () => {
    expect(spielBestaetigungsLink(ORIGIN, "beispiel-eins")).toBe(`${ORIGIN}/bestaetigung/spiel?token=beispiel-eins`);
  });

  /* The link stands on the serving origin as the close does, so a configured
     trailing slash or path reaches neither, and a value that is no URL composes no message at all. */
  it("stands on the origin `mailOrigin` makes of the configured value", () => {
    expect(spielBestaetigungsLink(`${ORIGIN}/irgendwo/`, "t")).toBe(`${ORIGIN}${SPIEL_BESTAETIGUNG_PATH}?token=t`);
    expect(() => spielBestaetigungsLink("/bestaetigung", "t")).toThrow(/absolute origin/);
  });

  /* A token is a credential the backend compares byte for byte, and an unencoded `&` or `#` in one would end
     the parameter early and hand the page a token nothing matches. */
  it("percent-encodes the token, so nothing inside it can end the parameter", () => {
    expect(spielBestaetigungsLink(ORIGIN, "a b&c=d?e/f#g")).toBe(`${ORIGIN}${SPIEL_BESTAETIGUNG_PATH}?token=a%20b%26c%3Dd%3Fe%2Ff%23g`);
  });

  it("names a parameter the edge's own redaction map replaces", () => {
    assertRedactedAtTheEdge(spielBestaetigungsLink(ORIGIN, "beispiel-eins"));
  });
});
