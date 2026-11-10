import { assertRedactedAtTheEdge } from "@/test-support/edgeRedaction.ts";
import { describe, expect, it } from "vitest";

const { spielConfirmationLink } = await import("./spielEmail.ts");
const { mailFor } = await import("./mailKinds.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

describe("the fixture confirmation's link", () => {
  /* The link stands on the serving origin as the close does, so a configured
     trailing slash or path reaches neither, and a value that is no URL composes no message at all. */
  it("stands on the origin `mailOrigin` makes of the configured value", () => {
    expect(spielConfirmationLink(`${ORIGIN}/irgendwo/`, "t")).toBe(`${ORIGIN}/confirm/spiel?token=t`);
    expect(() => spielConfirmationLink("/confirm", "t")).toThrow(/absolute origin/);
  });

  it("names a parameter the edge's own redaction map replaces", () => {
    assertRedactedAtTheEdge(spielConfirmationLink(ORIGIN, "example-one"));
  });

  /* The token exists only in the hand-out's answer, so a request rendered from its row's facts alone would ask a club to
     confirm through a button leading nowhere, with nothing failing. */
  it("is the button of the request the hand-out renders, its own token on the serving origin", () => {
    const data = {
      kind: "spiel_request",
      team: "Goethe-Gymnasium",
      team_id: "6890a1b2c3d4e5f607000001",
      saison_id: "2026",
      ansetzung: { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", date: "2026-11-20", time: "14:30:00", spielort: null },
      deadline: "2026-11-10",
      moved_from: null,
    } as const;

    const mail = mailFor("spiel_request", data, { token: "example-one", secret: null, origin: ORIGIN });

    expect(mail?.button).toStrictEqual({ label: "Spieltermin bestätigen", href: spielConfirmationLink(ORIGIN, "example-one") });
    expect(() => mailFor("spiel_request", data, { token: null, secret: null, origin: ORIGIN })).toThrow(/handed out without one/);
  });
});

/* A move told on its own reaches a party to be asked again alike with one whose answer about the new slot stands and one
   the move took off the fixture, and nothing but `asked_again` keeps the other two from being promised a request that
   never comes. */
describe("the notice of a move", () => {
  const left = { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", date: "2026-11-20", time: "14:30:00" };
  const next = { ...left, date: "2026-11-27" };
  const shapes = [next, null].flatMap((movedTo) =>
    [true, false].map((askedAgain) => ({ movedTo, askedAgain, slot: movedTo === null ? "no new slot" : "a new slot" })),
  );

  it.each(shapes)(
    "promises the next request or Einteilung only where it follows: $slot, asked again $askedAgain",
    ({ movedTo, askedAgain }) => {
      for (const [recipient, promise] of [
        ["team", "neue Anfrage"],
        ["schiedsrichter", "neue Einteilung"],
      ] as const) {
        const mail = mailFor(
          "spiel_moved",
          { kind: "spiel_moved", recipient, appointment: left, moved_to: movedTo, asked_again: askedAgain },
          { token: null, secret: null, origin: ORIGIN },
        );

        expect(JSON.stringify(mail).includes(promise)).toBe(askedAgain);
      }
    },
  );
});
