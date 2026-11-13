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

/* A party still on a moved fixture is told the move whether or not the fixture holds a new slot, and one taken off it is
   told the request no longer holds: told the other, a club waits at the slot it left, or a staying referee reads that
   they no longer referee. A notice queued before `stays` was written keeps the mail it was queued for. */
describe("the notice of a move", () => {
  const left = { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", date: "2026-11-20", time: "14:30:00" };
  const next = { ...left, date: "2026-11-27", spielort: "Halle Nord" };
  const recipients = ["team", "schiedsrichter"] as const;
  const moved = (mail: ReturnType<typeof mailFor>) => JSON.stringify(mail).includes("ist verlegt");

  it.each(recipients)("tells a staying %s of the move, promising nothing, where the fixture holds no new slot", (recipient) => {
    const mail = mailFor(
      "spiel_moved",
      { kind: "spiel_moved", recipient, appointment: left, moved_to: null, stays: true, asked_again: false },
      { token: null, secret: null, origin: ORIGIN },
    );

    expect(moved(mail)).toBe(true);
    expect(JSON.stringify(mail)).not.toMatch(/neue (Anfrage|Einteilung)/);
  });

  it("tells a club taken off the fixture that its request no longer holds", () => {
    const mail = mailFor(
      "spiel_moved",
      { kind: "spiel_moved", recipient: "team", appointment: left, moved_to: null, stays: false, asked_again: false },
      { token: null, secret: null, origin: ORIGIN },
    );

    expect(JSON.stringify(mail)).toContain("gilt nicht mehr");
  });

  it("names the ground the fixture moved to, in the block a request names it in", () => {
    const sameHour = { ...next, date: left.date };
    const mail = mailFor(
      "spiel_moved",
      { kind: "spiel_moved", recipient: "team", appointment: left, moved_to: sameHour, stays: true, asked_again: false },
      { token: null, secret: null, origin: ORIGIN },
    );
    const block = mail?.block;
    const facts = block !== undefined && "facts" in block ? block.facts : [];

    expect(facts).toContainEqual({ label: COPY.spielplan.fact.spielort, value: "Halle Nord" });
    expect(JSON.stringify(mail)).not.toMatch(/neue (Anfrage|Einteilung)/);
  });

  const queued = [{ ...next, spielort: null }, null].flatMap((movedTo) =>
    [true, false].map((askedAgain) => ({ movedTo, askedAgain, slot: movedTo === null ? "no new slot" : "a new slot" })),
  );

  /* A replacement or a bracket correction changes the sides and keeps the slot: worded as moved, the reader looks for a
     new day that does not exist. */
  it("words a new pairing at its slot as no move, in a request, an Einteilung and a notice", () => {
    const replaced = { ...left, team1: "Carl-Schurz-Schule", spielort: "Halle Nord" };
    const origin = { token: null, secret: null, origin: ORIGIN };
    const mails = [
      mailFor(
        "spiel_request",
        {
          kind: "spiel_request",
          team: "Goethe-Gymnasium",
          team_id: "6890a1b2c3d4e5f607000001",
          saison_id: "2026",
          ansetzung: replaced,
          deadline: "2026-11-13",
          moved_from: left,
        },
        origin,
      ),
      mailFor("spiel_einteilung", { kind: "spiel_einteilung", ansetzung: replaced, moved_from: left }, origin),
      mailFor(
        "spiel_moved",
        { kind: "spiel_moved", recipient: "team", appointment: left, moved_to: replaced, stays: true, asked_again: false },
        origin,
      ),
    ];

    for (const mail of mails) {
      expect(JSON.stringify(mail)).not.toContain("verlegt");
      expect(JSON.stringify(mail)).toContain(left.team1);
    }
  });

  // The hand-out serves such a row with `stays` at its default, false, and `asked_again` as it was written.
  it.each(queued)("builds a notice queued before `stays` as it was queued: $slot, asked again $askedAgain", ({ movedTo, askedAgain }) => {
    for (const [recipient, promise, unbooked] of [
      ["team", "neue Anfrage", "gilt nicht mehr"],
      ["schiedsrichter", "neue Einteilung", "nicht mehr."],
    ] as const) {
      const mail = mailFor(
        "spiel_moved",
        { kind: "spiel_moved", recipient, appointment: left, moved_to: movedTo, stays: false, asked_again: askedAgain },
        { token: null, secret: null, origin: ORIGIN },
      );
      const text = JSON.stringify(mail);

      expect(text.includes(promise)).toBe(askedAgain);
      expect(text.includes(unbooked)).toBe(movedTo === null && !askedAgain);
    }
  });
});

/* One mail serves every event that keeps a match from being played: worded alike, a match struck out or decided by a
   no-show would read as called off. None promises a request: a match called off and set again on its own day is
   asked about by nobody. */
describe("the notice of a match that will not be played", () => {
  const appointment = { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", date: "2026-11-20", time: "14:30:00" };
  // What the event means for the result, in the match page's own sentence: a no-show counts for the side that turned up.
  const { consequence } = COPY.spielplan.sonderereignis;
  const events = [
    { sonderereignis: "ausgefallen", subject: "Ausgefallen: Spiel am 20. November 2026", counted: consequence.notScored },
    { sonderereignis: "annulliert", subject: "Annulliert: Spiel am 20. November 2026", counted: consequence.notScored },
    {
      sonderereignis: "nichtantreten_team1",
      subject: "Nicht angetreten: Spiel am 20. November 2026",
      counted: consequence.nichtantreten({ record: appointment.team2 }),
    },
    {
      sonderereignis: "nichtantreten_team2",
      subject: "Nicht angetreten: Spiel am 20. November 2026",
      counted: consequence.nichtantreten({ record: appointment.team1 }),
    },
  ] as const;

  it.each(events)(
    "names $sonderereignis in its subject, counts the match as the match page does, and promises no request",
    ({ sonderereignis, subject, counted }) => {
      for (const recipient of ["team", "schiedsrichter"] as const) {
        const mail = mailFor(
          "spiel_cancelled",
          { kind: "spiel_cancelled", recipient, appointment, sonderereignis },
          { token: null, secret: null, origin: ORIGIN },
        );
        const text = JSON.stringify(mail);

        expect(mail?.subjectLine).toBe(subject);
        expect(text.includes(counted)).toBe(true);
        expect(text).not.toMatch(/neue (Anfrage|Einteilung)/);
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
    // The lead alone: nothing mails the walkover, so a sentence saying the league writes again is a promise nobody keeps.
    expect(mail?.paragraphs[0]).toHaveLength(1);
  });
});
