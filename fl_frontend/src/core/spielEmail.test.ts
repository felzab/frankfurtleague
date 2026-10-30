import { assertRedactedAtTheEdge } from "@/test-support/edgeRedaction.ts";
import { describe, expect, it } from "vitest";

const { SPIEL_BESTAETIGUNG_PATH, spielBestaetigungsLink } = await import("./spielEmail.ts");
const { mailFor } = await import("./mailKinds.ts");

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

  it("names a parameter the edge's own redaction map replaces", () => {
    assertRedactedAtTheEdge(spielBestaetigungsLink(ORIGIN, "beispiel-eins"));
  });

  /* The token exists only in the hand-out's answer, so a request rendered from its row's facts alone would ask a club to
     confirm through a button leading nowhere, with nothing failing. */
  it("is the button of the request the hand-out renders, its own token on the serving origin", () => {
    const daten = {
      art: "spiel_anfrage",
      team: "Goethe-Gymnasium",
      ansetzung: { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", datum: "2026-11-20", uhrzeit: "14:30:00", ort: null },
      frist: "2026-11-10",
    } as const;

    const mail = mailFor("spiel_anfrage", daten, { token: "beispiel-eins", geheim: null, origin: ORIGIN });

    expect(mail?.aktion).toStrictEqual({ label: "Spieltermin bestätigen", href: spielBestaetigungsLink(ORIGIN, "beispiel-eins") });
    expect(() => mailFor("spiel_anfrage", daten, { token: null, geheim: null, origin: ORIGIN })).toThrow(/handed out without one/);
  });
});
