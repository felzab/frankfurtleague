import { describe, expect, it } from "vitest";

const { mailFor } = await import("./mailKinds.ts");
const { ROUTES } = await import("./routes.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

describe("the fixture request", () => {
  /* The request carries no link: the club answers on its own Übersicht, signed in. Built from a token the hand-out no
     longer mints, it would throw at the drain and no club would hear of its fixture, with nothing else failing. */
  it("leads to the team's Übersicht on the serving origin, whether or not the hand-out carries a token", () => {
    const data = {
      kind: "spiel_request",
      team: "Goethe-Gymnasium",
      team_id: "6890a1b2c3d4e5f607000001",
      saison_id: "2026",
      ansetzung: { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", date: "2026-11-20", time: "14:30:00", spielort: null },
      deadline: "2026-11-10",
      moved_from: null,
    } as const;

    const mail = mailFor("spiel_request", data, { token: null, secret: null, origin: `${ORIGIN}/` });

    expect(mail?.button?.href).toBe(`${ORIGIN}${ROUTES.teamOverview.path(data.team_id, data.saison_id)}`);
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
