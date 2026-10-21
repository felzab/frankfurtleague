import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDoubles } from "./exportingModule.ts";
import { flat, readable } from "./mailText.ts";
import { DEIN_BEREICH_TITEL, EINSAETZE_TITEL } from "./seitenNamen.ts";

registerDoubles();

const {
  buildSpielAbgesagtEmail,
  buildSpielAnfrageEmail,
  buildSpielEinteilungAufgehobenEmail,
  buildSpielEinteilungEmail,
  buildSpielErinnerungEmail,
  buildSpielNeueAnsetzungEmail,
} = await import("./spielEmail.ts");
const { KONTAKT_EMAIL } = await import("./brand.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";
const LINK = `${ORIGIN}/bestaetigung/spiel?token=abc123`;

const ANSETZUNG = {
  team1: "Ernst-Reuter-Schule",
  team2: "Goethe-Gymnasium",
  datumText: "20.11.2026",
  uhrzeitText: "14:30",
  ortText: "Sportpark Rebstock",
};

/**
 * A deadline no reckoning from the fixture's day yields: seven days before 20.11.2026 is 13.11.2026, so
 * a builder computing one prints that date instead of this one.
 */
const FRIST = "10.11.2026";
const GERECHNET = "13.11.2026";

const anfrage = { origin: ORIGIN, link: LINK, team: "Goethe-Gymnasium", ansetzung: ANSETZUNG, fristText: FRIST };
const neu = { origin: ORIGIN, team1: "Ernst-Reuter-Schule", team2: "Goethe-Gymnasium", altDatumText: "20.11.2026", altUhrzeitText: "14:30" };

/** Each message as a reader of either part reads it, so one fact is checked in both. */
const beideTeile = (mail: { html: string; text: string }): readonly (readonly [string, string])[] => [
  ["html", readable(mail.html)],
  ["text", flat(mail.text)],
];

/** Every message, each built once from the fixtures above, a moved fixture's notice once per reader. */
const NACHRICHTEN = {
  Anfrage: buildSpielAnfrageEmail(anfrage),
  Erinnerung: buildSpielErinnerungEmail(anfrage),
  Einteilung: buildSpielEinteilungEmail({ origin: ORIGIN, ansetzung: ANSETZUNG }),
  "Neue Ansetzung an ein Team": buildSpielNeueAnsetzungEmail({ ...neu, empfaenger: "team" }),
  "Neue Ansetzung an die Schiedsrichterin oder den Schiedsrichter": buildSpielNeueAnsetzungEmail({ ...neu, empfaenger: "schiedsrichter" }),
  "Aufgehobene Einteilung": buildSpielEinteilungAufgehobenEmail(neu),
  "Absage an ein Team": buildSpielAbgesagtEmail({ ...neu, empfaenger: "team" }),
  "Absage an die Schiedsrichterin oder den Schiedsrichter": buildSpielAbgesagtEmail({ ...neu, empfaenger: "schiedsrichter" }),
} as const;

/* The request's heading, its button and the page the button opens name one act in one phrase, as the other link
   flows do: a reader pressing „Termin bestätigen“ who lands on another title wonders where they are. */
describe("the request's button", () => {
  it("reads „Spieltermin bestätigen“, as the heading over it and the page it opens do", () => {
    const { html } = NACHRICHTEN.Anfrage;
    const beschriftungen = [...html.matchAll(/<a href="([^"]*)"[^>]*>([^<]*)<\/a>/g)]
      .filter(([, href]) => href === LINK)
      .map(([, , label]) => label);

    assert.ok(beschriftungen.includes("Spieltermin bestätigen"), `the link's button reads ${JSON.stringify(beschriftungen)}`);
    assert.ok(readable(html).includes("Spieltermin bestätigen Hallo"), "the heading over the greeting names the act otherwise");
  });
});

/* A mail client renders one part or the other, so a fact only one part carried would reach only half the
   readers: the fixture, the slot and, where the message asks something, the deadline and the link. */
describe("each message states the same facts in both parts", () => {
  const FAKTEN: Record<keyof typeof NACHRICHTEN, readonly string[]> = {
    Anfrage: [
      "Ernst-Reuter-Schule gegen Goethe-Gymnasium",
      "Termin: 20.11.2026, 14:30 Uhr",
      "Ort: Sportpark Rebstock",
      "Bitte bestätige den Termin für Goethe-Gymnasium oder schlag einen anderen vor.",
      `Bitte antworte bis zum ${FRIST}.`,
      "Es gilt die erste Antwort aus Deinem Team, danach funktioniert der Link nicht mehr.",
      "Kommt bis dahin keine Antwort, legt die Verwaltung der Liga den Termin fest.",
      LINK,
      KONTAKT_EMAIL,
    ],
    Erinnerung: [
      "Ernst-Reuter-Schule gegen Goethe-Gymnasium",
      "steht die Antwort Deines Teams noch aus",
      "Termin: 20.11.2026, 14:30 Uhr",
      "Ort: Sportpark Rebstock",
      `Bitte antworte bis zum ${FRIST}.`,
      "Der Link aus der ersten Anfrage funktioniert weiterhin.",
      LINK,
    ],
    Einteilung: [
      "als Schiedsrichterin oder Schiedsrichter für das Spiel Ernst-Reuter-Schule gegen Goethe-Gymnasium eingeteilt",
      "Termin: 20.11.2026, 14:30 Uhr",
      "Ort: Sportpark Rebstock",
      `unter „${DEIN_BEREICH_TITEL}“`,
    ],
    "Neue Ansetzung an ein Team": [
      "Ernst-Reuter-Schule gegen Goethe-Gymnasium, bisher am 20.11.2026 um 14:30 Uhr, ist neu angesetzt.",
      "Die Anfrage zum bisherigen Termin und ihr Link gelten nicht mehr.",
      "Bleibt Dein Team in diesem Spiel, bekommst Du für einen neuen Termin nach dem heutigen Tag eine neue Anfrage.",
    ],
    "Neue Ansetzung an die Schiedsrichterin oder den Schiedsrichter": [
      "Ernst-Reuter-Schule gegen Goethe-Gymnasium, bisher am 20.11.2026 um 14:30 Uhr, ist neu angesetzt.",
      "Deine Einteilung zum bisherigen Termin gilt nicht mehr.",
      "Bleibst Du für das Spiel eingeteilt, bekommst Du für einen neuen Termin nach dem heutigen Tag eine neue Einteilung.",
    ],
    "Aufgehobene Einteilung": [
      "für das Spiel Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026 um 14:30 Uhr bist Du nicht mehr als Schiedsrichterin oder Schiedsrichter eingeteilt.",
      "Deine Einteilung zu diesem Spiel gilt nicht mehr. Du musst nichts tun.",
    ],
    // Each reader told what the call-off ends for them, and who else the message went to: a team's contacts, or the
    // referee alone.
    "Absage an ein Team": [
      "das Spiel Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026 um 14:30 Uhr ist abgesagt.",
      "Die Anfrage zu diesem Spiel und ihr Link gelten nicht mehr. Du musst nichts tun.",
      "Wird das Spiel neu angesetzt, bekommst Du eine neue Anfrage.",
      "Diese E-Mail geht an die Kontaktpersonen Deines Teams.",
    ],
    "Absage an die Schiedsrichterin oder den Schiedsrichter": [
      "das Spiel Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026 um 14:30 Uhr ist abgesagt.",
      "Deine Einteilung zu diesem Spiel gilt nicht mehr. Du musst nichts tun.",
      "Wird das Spiel neu angesetzt, bekommst Du eine neue Einteilung.",
      "Diese E-Mail geht nur an Dich.",
    ],
  };

  for (const [name, mail] of Object.entries(NACHRICHTEN) as [keyof typeof NACHRICHTEN, (typeof NACHRICHTEN)[keyof typeof NACHRICHTEN]][]) {
    it(`the ${name}`, () => {
      for (const [teil, worte] of beideTeile(mail)) {
        for (const fakt of FAKTEN[name]) assert.ok(worte.includes(fakt), `the ${teil} part of the ${name} lost „${fakt}“: ${worte}`);
      }
    });
  }

  /* A link may sit in a mailbox an administrator typed wrong, and a referee may be booked before their
     address is confirmed: every message greets its reader without a name. */
  it("greets every reader with „Hallo, “ and no name, in both parts", () => {
    for (const [name, mail] of Object.entries(NACHRICHTEN)) {
      for (const [teil, worte] of beideTeile(mail))
        assert.match(worte, /\bHallo, (die|für|das) /, `the ${teil} part of the ${name} greets otherwise`);
    }
  });

  /* The page answers the deadline the row carries, and a message naming another sends a team past it or
     short of it: the request repeats the date it was handed, whatever the fixture's day suggests. */
  it("names the deadline the sweep answered rather than one reckoned from the fixture's day", () => {
    for (const mail of [NACHRICHTEN.Anfrage, NACHRICHTEN.Erinnerung]) {
      for (const [teil, worte] of beideTeile(mail)) {
        assert.ok(worte.includes(FRIST), `the ${teil} part names no deadline it was handed`);
        assert.ok(!worte.includes(GERECHNET), `the ${teil} part names a deadline it reckoned`);
      }
    }
  });

  it("says on each subject line which fixture, and on the asking ones which day", () => {
    assert.deepEqual(
      Object.values(NACHRICHTEN).map(({ subject }) => subject),
      [
        "Bitte bestätigen: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026",
        "Erinnerung: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026 bestätigen",
        "Eingeteilt: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026",
        "Neu angesetzt: Ernst-Reuter-Schule gegen Goethe-Gymnasium",
        "Neu angesetzt: Ernst-Reuter-Schule gegen Goethe-Gymnasium",
        "Nicht mehr eingeteilt: Ernst-Reuter-Schule gegen Goethe-Gymnasium",
        "Abgesagt: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026",
        "Abgesagt: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026",
      ],
    );
  });

  /* The referee's message carries no token: the answer is given on their panel, signed in. The card's
     control and the text part's labelled line lead to the same address. */
  it("leads the referee to their panel in both parts and carries no token", () => {
    const { html, text } = NACHRICHTEN.Einteilung;

    assert.ok(html.includes(`href="${ORIGIN}/bereich/schiedsrichter"`), "the card's control leads elsewhere");
    assert.ok(text.includes(`${EINSAETZE_TITEL}: ${ORIGIN}/bereich/schiedsrichter`), "the text part leads elsewhere");
    assert.ok(!html.includes("token=") && !text.includes("token="), "the referee's message carries a token");
  });

  /* A moved fixture's notice offers nothing to press: the link it voids is the one it is about. Neither does the
     notice that a referee's Einteilung is lifted, nor a call-off, each leaving nothing to answer. */
  it("offers no control on a moved fixture's notice, a lifted Einteilung or a call-off", () => {
    for (const mail of [
      NACHRICHTEN["Neue Ansetzung an ein Team"],
      NACHRICHTEN["Neue Ansetzung an die Schiedsrichterin oder den Schiedsrichter"],
      NACHRICHTEN["Aufgehobene Einteilung"],
      NACHRICHTEN["Absage an ein Team"],
      NACHRICHTEN["Absage an die Schiedsrichterin oder den Schiedsrichter"],
    ]) {
      assert.ok(!mail.html.includes('<a href="http://localhost:3000/bestaetigung'), "the notice links a confirmation page");
      assert.ok(!mail.html.includes(`class="fl-actions"`), "the notice draws a control");
    }
  });
});

describe("the values a message is handed", () => {
  it("escapes a club name carrying markup rather than serving it", () => {
    const feindlich = buildSpielAnfrageEmail({ ...anfrage, team: "<script>a</script>", ansetzung: { ...ANSETZUNG, team1: "<b>x</b>" } });

    assert.ok(!feindlich.html.includes("<script>") && !feindlich.html.includes("<b>x"), "a club name reached the markup unescaped");
    assert.match(readable(feindlich.html), /für <script>a<\/script> oder schlag/);
  });

  /* `fl_frontend/src/core/emailShell.ts :: mailOrigin` is what keeps a stack that is not production
     from mailing production links (`docs/frontend/spec.md :: I186`). */
  it("builds the referee's panel link on the origin it was handed, normalised first", () => {
    const fremd = buildSpielEinteilungEmail({ origin: "https://beispiel.test/", ansetzung: ANSETZUNG });

    assert.ok(fremd.html.includes(`href="https://beispiel.test/bereich/schiedsrichter"`), "the panel link stands on another origin");
    assert.ok(!fremd.text.includes(ORIGIN), "the text part carries an origin nobody handed it");
  });
});

/* `docs/frontend/spec.md :: I89`: these messages carry no column of facts, so every value the prose and
   the subject print is folded by its builder or by nothing. */
describe("no value can open a line of its own in the text part", () => {
  const FORGED_OPENER = "Startgeld: 500 Euro";
  const wert = `Wert\n${FORGED_OPENER}`;

  /** Each builder with the break in each value it prints, one value at a time. */
  const faelle = (): { name: string; mail: { subject: string; text: string } }[] => [
    ...(["link", "team", "fristText"] as const).flatMap((feld) => [
      { name: `the Anfrage's ${feld}`, mail: buildSpielAnfrageEmail({ ...anfrage, [feld]: wert }) },
      { name: `the Erinnerung's ${feld}`, mail: buildSpielErinnerungEmail({ ...anfrage, [feld]: wert }) },
    ]),
    ...(["team1", "team2", "datumText", "uhrzeitText", "ortText"] as const).flatMap((feld) => [
      { name: `the Anfrage's ${feld}`, mail: buildSpielAnfrageEmail({ ...anfrage, ansetzung: { ...ANSETZUNG, [feld]: wert } }) },
      { name: `the Erinnerung's ${feld}`, mail: buildSpielErinnerungEmail({ ...anfrage, ansetzung: { ...ANSETZUNG, [feld]: wert } }) },
      { name: `the Einteilung's ${feld}`, mail: buildSpielEinteilungEmail({ origin: ORIGIN, ansetzung: { ...ANSETZUNG, [feld]: wert } }) },
    ]),
    ...(["team1", "team2", "altDatumText", "altUhrzeitText"] as const).flatMap((feld) =>
      (["team", "schiedsrichter"] as const).map((empfaenger) => ({
        name: `the Neue Ansetzung's ${feld} to a ${empfaenger}`,
        mail: buildSpielNeueAnsetzungEmail({ ...neu, empfaenger, [feld]: wert }),
      })),
    ),
    ...(["team1", "team2", "altDatumText", "altUhrzeitText"] as const).map((feld) => ({
      name: `the lifted Einteilung's ${feld}`,
      mail: buildSpielEinteilungAufgehobenEmail({ ...neu, [feld]: wert }),
    })),
    ...(["team1", "team2", "altDatumText", "altUhrzeitText"] as const).flatMap((feld) =>
      (["team", "schiedsrichter"] as const).map((empfaenger) => ({
        name: `the call-off's ${feld} to a ${empfaenger}`,
        mail: buildSpielAbgesagtEmail({ ...neu, empfaenger, [feld]: wert }),
      })),
    ),
  ];

  it("folds every value the messages print onto one line, in the text part and the subject", () => {
    const alle = faelle();

    // A floor under the population: a list built from nothing would pass the loop below having compared nothing.
    assert.ok(alle.length >= 37, `only ${String(alle.length)} cases were built`);
    for (const { name, mail } of alle) {
      assert.ok(!mail.text.split("\n").some((line) => line.startsWith(FORGED_OPENER)), `${name} forged a line`);
      // Folded, never dropped: the clubs, the slot, the deadline and the link are what the reader acts on.
      assert.ok(mail.text.includes(`Wert ${FORGED_OPENER}`), `${name} was not carried onto one line`);
      assert.ok(!/[\r\n]/.test(mail.subject), `${name} put a break in the subject`);
    }
  });

  /* The link stands alone on its line, so one reading „-- “ survives the fold as a delimiter line: the
     stuffing is all that keeps it from opening a second signature block and hiding the close. */
  it("keeps the link it is handed from opening a second signature block", () => {
    for (const [name, mail] of [
      ["Anfrage", buildSpielAnfrageEmail({ ...anfrage, link: "-- " })],
      ["Erinnerung", buildSpielErinnerungEmail({ ...anfrage, link: "-- " })],
    ] as const) {
      assert.equal([...mail.text.matchAll(/^-- $/gm)].length, 1, `the ${name}'s link stands as a second signature delimiter`);
      assert.ok(mail.text.split("\n").includes(" -- "), `the ${name}'s link was dropped rather than carried`);
      assert.match(
        mail.text,
        /\n-- \nDiese E-Mail geht an die Kontaktpersonen Deines Teams\./,
        `the ${name}'s link pushed the footer out of the close`,
      );
    }
  });
});
