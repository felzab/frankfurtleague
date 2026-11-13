import { describe, expect, it } from "vitest";

const { mailFor } = await import("./mailKinds.ts");
const { ROUTES } = await import("./routes.ts");
const { COPY } = await import("./copy.ts");

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

/* One mail serves every event that keeps a match from being played: worded alike, a match struck out or decided by a
   no-show would read as called off, and its parties would wait for a request that never comes. */
describe("the notice of a match that will not be played", () => {
  const appointment = { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", date: "2026-11-20", time: "14:30:00" };
  // What the event means for the result, in the match page's own sentence: a no-show counts for the side that turned up.
  const { consequence } = COPY.spielplan.sonderereignis;
  const events = [
    { sonderereignis: "ausgefallen", subject: "Ausgefallen: Spiel am 20. November 2026", counted: consequence.notScored, promised: true },
    { sonderereignis: "annulliert", subject: "Annulliert: Spiel am 20. November 2026", counted: consequence.notScored, promised: false },
    {
      sonderereignis: "nichtantreten_team1",
      subject: "Nicht angetreten: Spiel am 20. November 2026",
      counted: consequence.nichtantreten({ record: appointment.team2 }),
      promised: false,
    },
    {
      sonderereignis: "nichtantreten_team2",
      subject: "Nicht angetreten: Spiel am 20. November 2026",
      counted: consequence.nichtantreten({ record: appointment.team1 }),
      promised: false,
    },
  ] as const;

  it.each(events)(
    "names $sonderereignis in its subject, counts the match as the match page does, and promises a request only where one follows",
    ({ sonderereignis, subject, counted, promised }) => {
      for (const [recipient, promise] of [
        ["team", "neue Anfrage"],
        ["schiedsrichter", "neue Einteilung"],
      ] as const) {
        const mail = mailFor(
          "spiel_cancelled",
          { kind: "spiel_cancelled", recipient, appointment, sonderereignis },
          { token: null, secret: null, origin: ORIGIN },
        );
        const text = JSON.stringify(mail);

        expect(mail?.subjectLine).toBe(subject);
        expect(text.includes(counted)).toBe(true);
        expect(text.includes(promise)).toBe(promised);
      }
    },
  );
});

/* The opponent reads the open fixtures outside any season's page, so a row without its year names no day: a match row's
   short date reads the same in every season. */
describe("the notice of a club's exit", () => {
  it("dates each open fixture with its year, and an undated one by what is still to settle", () => {
    const sides = { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium" };
    const mail = mailFor(
      "austritt_notice",
      {
        kind: "austritt_notice",
        team: "Goethe-Gymnasium",
        saison_id: "2027",
        spiele: [
          { ...sides, date: "2027-03-14", time: "15:30:00" },
          { ...sides, date: "2027-03-21", time: null },
          { ...sides, date: null, time: null },
        ],
      },
      { token: null, secret: null, origin: ORIGIN },
    );
    const block = mail?.block;
    const labels = block !== undefined && "facts" in block ? block.facts.map((fact) => fact.label) : [];

    expect(labels).toStrictEqual(["14. März 2027 um 15:30", "21. März 2027", COPY.spielplan.when(null, null)]);
  });
});
