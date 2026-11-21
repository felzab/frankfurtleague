import { describe, expect, it } from "vitest";

const { mailFor } = await import("./mailKinds");
const { renderMail } = await import("./emailShell");
const { ROUTES } = await import("./routes");
const { COPY } = await import("./copy/shared");
const { SERVER_COPY } = await import("./serverCopy");
const { dayOf, formatDayAndTime, timeOf } = await import("./format");

const WORDS = SERVER_COPY.mail.spiel;

type Slot = { team1: string; team2: string; date: string; time: string };

/** A fixture's pairing and moment in the words the builder sets them in, so a case compares with the entry itself. */
const paarung = ({ team1, team2 }: Slot) => COPY.page.spiel({ record: team1 }, { record: team2 });
const moment = ({ date, time }: Slot) => ({ strong: formatDayAndTime(dayOf(date), timeOf(time)) });

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";
const TO = "kontakt@schule.example.org";

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

    const mail = mailFor("spiel_request", data, { token: null, secret: null, origin: `${ORIGIN}/`, to: TO });

    expect(mail?.button?.href).toBe(`${ORIGIN}${ROUTES.teamOverview.path(data.team_id, data.saison_id)}`);
  });
});

/* A party still on a moved fixture is told the move whether or not the fixture holds a new slot, and one taken off it is
   told the request no longer holds: told the other, a club waits at the slot it left, or a staying referee reads that
   they no longer referee. */
describe("the notice of a move", () => {
  const left = { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", date: "2026-11-20", time: "14:30:00" };
  const next = { ...left, date: "2026-11-27", spielort: "Halle Nord" };
  const recipients = ["team", "schiedsrichter"] as const;

  it.each(recipients)("tells a staying %s of the move, promising nothing, where the fixture holds no new slot", (recipient) => {
    const mail = mailFor(
      "spiel_moved",
      { kind: "spiel_moved", recipient, appointment: left, moved_to: null, stays: true },
      { token: null, secret: null, origin: ORIGIN, to: TO },
    );

    expect(mail?.subjectLine).toBe(WORDS.movedFromSubject(dayOf(left.date)));
    expect(mail?.paragraphs).toStrictEqual([[WORDS.moved(paarung(left))]]);
    expect(mail?.afterBlock).toBeUndefined();
  });

  it("tells a club taken off the fixture that its request no longer holds", () => {
    const mail = mailFor(
      "spiel_moved",
      { kind: "spiel_moved", recipient: "team", appointment: left, moved_to: null, stays: false },
      { token: null, secret: null, origin: ORIGIN, to: TO },
    );

    expect(mail?.subjectLine).toBe(WORDS.voidSubject(dayOf(left.date)));
    expect(mail?.paragraphs).toStrictEqual([[WORDS.void(paarung(left), moment(left).strong)]]);
  });

  it("names the ground the fixture moved to, in the block a request names it in", () => {
    const sameHour = { ...next, date: left.date };
    const mail = mailFor(
      "spiel_moved",
      { kind: "spiel_moved", recipient: "team", appointment: left, moved_to: sameHour, stays: true },
      { token: null, secret: null, origin: ORIGIN, to: TO },
    );
    const block = mail?.block;
    const facts = block !== undefined && "facts" in block ? block.facts : [];

    expect(facts).toContainEqual({ label: COPY.spielplan.fact.spielort, value: "Halle Nord" });
    expect(mail?.paragraphs).toStrictEqual([[WORDS.moved(paarung(sameHour))]]);
    expect(mail?.afterBlock).toBeUndefined();
  });

  /* A replacement or a bracket correction changes the sides and keeps the slot: worded as moved, the reader looks for a
     new day that does not exist. */
  it("words a new pairing at its slot as no move, in a request, an Einteilung and a notice", () => {
    const replaced = { ...left, team1: "Carl-Schurz-Schule", spielort: "Halle Nord" };
    const origin = { token: null, secret: null, origin: ORIGIN, to: TO };
    const day = dayOf(replaced.date);
    // Each mail under the subject its kind gives a fixture nothing moved.
    const mails = [
      {
        subject: WORDS.requestSubject(day),
        mail: mailFor(
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
      },
      {
        subject: WORDS.bookedSubject(day),
        mail: mailFor("spiel_einteilung", { kind: "spiel_einteilung", ansetzung: replaced, moved_from: left }, origin),
      },
      {
        subject: WORDS.keptSubject(day),
        mail: mailFor("spiel_moved", { kind: "spiel_moved", recipient: "team", appointment: left, moved_to: replaced, stays: true }, origin),
      },
    ];

    for (const { subject, mail } of mails) {
      const block = mail?.block;
      const labels = block !== undefined && "facts" in block ? block.facts.map((fact) => fact.label) : [];

      expect(mail?.subjectLine).toBe(subject);
      // The slot named once, and beside it the pairing that held it: a „Neu“ row would repeat the moment left.
      expect(labels).toStrictEqual([
        COPY.spielplan.fact.date,
        COPY.spielplan.fact.time,
        COPY.shared.facts.before,
        COPY.spielplan.fact.spielort,
      ]);
      expect(JSON.stringify(mail)).toContain(left.team1);
      // The lead opens on the change the mail exists for, the new pairing at the slot it keeps.
      expect(mail?.paragraphs[0]?.[0]).toBe(WORDS.newPairing(paarung(replaced)));
    }
  });

  /* The shell lowers a mail's first letter after „Hallo,“ unless the mail opens on a noun: a lead opening on the pairing
     loses that mark, and the first club's name would reach the reader lower-cased. */
  it("renders a moved fixture's lead with the pairing as the catalogue writes it, capital first", () => {
    const mail = mailFor(
      "spiel_moved",
      { kind: "spiel_moved", recipient: "team", appointment: left, moved_to: next, stays: true },
      { token: null, secret: null, origin: ORIGIN, to: TO },
    );
    if (mail === undefined) throw new Error("the move built no mail");

    expect(renderMail(mail).text.split("\n")).toContain(WORDS.moved(paarung(next)));
  });

  // An hour moved on the same day is a move, whatever the sides did.
  it("words a new pairing at a new hour of the same day as a move", () => {
    const replaced = { ...left, team1: "Carl-Schurz-Schule", time: "16:00:00", spielort: "Halle Nord" };
    const mail = mailFor(
      "spiel_moved",
      { kind: "spiel_moved", recipient: "team", appointment: left, moved_to: replaced, stays: true },
      { token: null, secret: null, origin: ORIGIN, to: TO },
    );

    expect(mail?.subjectLine).toBe(WORDS.movedSubject(dayOf(replaced.date)));
    expect(mail?.paragraphs).toStrictEqual([[WORDS.moved(paarung(replaced))]]);
  });
});

/* One mail serves every event that keeps a match from being played: worded alike, a match struck out or decided by a
   no-show would read as called off. None promises a request: a match called off and set again on its own day is
   asked about by nobody. */
describe("the notice of a match that will not be played", () => {
  const appointment = { team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", date: "2026-11-20", time: "14:30:00" };
  const day = dayOf(appointment.date);
  const spiel = paarung(appointment);
  const when = moment(appointment);
  const { cancelled } = WORDS;
  // A no-show counts for the side that turned up, in the match page's own sentence.
  const { consequence } = COPY.spielplan.sonderereignis;
  const events = [
    {
      sonderereignis: "ausgefallen",
      subject: cancelled.ausgefallen.subject(day),
      paragraph: [cancelled.ausgefallen.lead(spiel, when.strong)],
    },
    {
      sonderereignis: "annulliert",
      subject: cancelled.annulliert.subject(day),
      paragraph: [cancelled.annulliert.lead(spiel, when.strong)],
    },
    {
      sonderereignis: "nichtantreten_team1",
      subject: cancelled.nichtantreten.subject(day),
      paragraph: [
        cancelled.nichtantreten.lead({ record: appointment.team1 }, when.strong),
        consequence.nichtantreten({ record: appointment.team2 }),
      ],
    },
    {
      sonderereignis: "nichtantreten_team2",
      subject: cancelled.nichtantreten.subject(day),
      paragraph: [
        cancelled.nichtantreten.lead({ record: appointment.team2 }, when.strong),
        consequence.nichtantreten({ record: appointment.team1 }),
      ],
    },
  ] as const;

  it.each(events)(
    "names $sonderereignis in its subject and its one paragraph, and promises no request",
    ({ sonderereignis, subject, paragraph }) => {
      for (const recipient of ["team", "schiedsrichter"] as const) {
        const mail = mailFor(
          "spiel_cancelled",
          { kind: "spiel_cancelled", recipient, appointment, sonderereignis },
          { token: null, secret: null, origin: ORIGIN, to: TO },
        );

        expect(mail?.subjectLine).toBe(subject);
        expect(mail?.paragraphs).toStrictEqual([paragraph]);
        expect(mail?.afterBlock).toBeUndefined();
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
      { token: null, secret: null, origin: ORIGIN, to: TO },
    );
    const block = mail?.block;
    const labels = block !== undefined && "facts" in block ? block.facts.map((fact) => fact.label) : [];

    expect(labels).toStrictEqual(["14. März 2027 um 15:30", "21. März 2027", COPY.spielplan.when(null, null)]);
    // The lead alone, before the block or after it: nothing mails the walkover, so a sentence saying the league writes
    // again is a promise nobody keeps.
    expect(mail?.paragraphs).toStrictEqual([[expect.anything()]]);
    expect(mail?.afterBlock).toBeUndefined();
  });
});
