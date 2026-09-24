import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { redactedParameterNames } from "./edgeRedaction.ts";

import type { RegistrierungLinkEmailData } from "./registrierungEmail.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const {
  buildRegistrierungBestaetigungEmail,
  buildRegistrierungErinnerungEmail,
  buildRegistrierungSaisonendeEmail,
  spielerBestaetigungsLink,
  SPIELER_BESTAETIGUNG_PATH,
} = await import("./registrierungEmail.ts");

const ORIGIN = "https://beispiel.test";
const TOKEN = "beispiel-eins";
const LINK = `${ORIGIN}${SPIELER_BESTAETIGUNG_PATH}?token=${TOKEN}`;

/** Seven is the mirrored deadline's value today; the cases read the figure they passed rather than that one. */
const FRIST_TAGE = 7;

const LINK_DATEN: RegistrierungLinkEmailData = {
  vorname: "Mira",
  teamName: "Lessing-Kolleg",
  saisonId: "2026",
  origin: ORIGIN,
  token: TOKEN,
  fristTage: FRIST_TAGE,
};

const NOTIZ_DATEN = { vorname: "Mira", teamName: "Lessing-Kolleg", saisonId: "2026", origin: ORIGIN };

const MESSAGES = {
  bestaetigung: buildRegistrierungBestaetigungEmail(LINK_DATEN),
  erinnerung: buildRegistrierungErinnerungEmail(LINK_DATEN),
  saisonende: buildRegistrierungSaisonendeEmail(NOTIZ_DATEN),
};

describe("the pupil's confirmation link", () => {
  /* The name is the whole of what the edge matches on (`docs/logging/spec.md :: L11`), so a link
     spelled with any other parameter writes the credential into the access line and the referer. */
  it("names a parameter the edge's own redaction map replaces", () => {
    const redacted = redactedParameterNames();
    const name = /\?(\w+)=/.exec(spielerBestaetigungsLink(ORIGIN, "kein-echtes-token"))?.[1] ?? "";

    assert.ok(redacted.length > 0, "the edge's map was read as replacing no parameter at all, so this case compares nothing");
    assert.ok(redacted.includes(name), `the link is spelled \`${name}=\`, which the edge does not redact`);
  });

  it("lands on the pupil's own segment rather than the shared confirmation path", () => {
    assert.equal(SPIELER_BESTAETIGUNG_PATH, "/bestaetigung/spieler", "the link opens a page other than the pupil's");
  });

  it("escapes a value the token alphabet could widen to", () => {
    // `secrets.token_urlsafe` mints no `+` today. A mint that ever did would otherwise reach the
    // query string as a space, and the link would open nothing.
    assert.ok(spielerBestaetigungsLink(ORIGIN, "a+b/c").endsWith("token=a%2Bb%2Fc"), "the token reaches the query string unescaped");
  });

  /* BOTH builders, because a configured trailing slash is one setting and the two messages read it
     on different days: the one that normalises alone leaves `//bestaetigung/spieler` in an inbox,
     which the edge's noindex prefix does not match. */
  it("is minted on the normalised origin by each builder, not on the raw value the caller read", () => {
    for (const [name, gebaut] of [
      ["the confirmation link", buildRegistrierungBestaetigungEmail({ ...LINK_DATEN, origin: `${ORIGIN}/` })],
      ["the reminder", buildRegistrierungErinnerungEmail({ ...LINK_DATEN, origin: `${ORIGIN}/` })],
    ] as const) {
      assert.ok(gebaut.html.includes(`${ORIGIN}${SPIELER_BESTAETIGUNG_PATH}?token=`), `${name}: a configured trailing slash reaches the link`);
      assert.doesNotMatch(gebaut.html, /\/\/bestaetigung\/spieler/, `${name}: the link doubles the slash the origin already carried`);
    }
  });
});

describe("what every message of the registration flow carries", () => {
  it("names the team and the season in its subject, so an inbox of three tells them apart", () => {
    const subjects = Object.values(MESSAGES).map((mail) => mail.subject);

    assert.equal(new Set(subjects).size, subjects.length, "two of the three messages arrive under one subject");
    for (const [name, mail] of Object.entries(MESSAGES)) {
      assert.ok(mail.subject.includes(LINK_DATEN.teamName), `${name}'s subject names no team`);
    }
  });

  it("closes both branches on the origin it was handed", () => {
    for (const [name, mail] of Object.entries(MESSAGES)) {
      for (const seite of ["datenschutz", "impressum"]) {
        assert.ok(mail.html.includes(`href="${ORIGIN}/${seite}"`), `${name}'s close links ${seite} on some other origin`);
        assert.ok(mail.text.includes(`: ${ORIGIN}/${seite}`), `${name}'s text branch closes on ${seite} at some other origin`);
      }
    }
  });

  it("addresses the reader by the forename and never by a surname it was never given", () => {
    for (const [name, mail] of Object.entries(MESSAGES)) {
      assert.ok(mail.text.includes(LINK_DATEN.vorname), `${name} names nobody`);
    }
  });

  /* A team name is typed outside the league and lands inside markup no framework is watching. */
  it("escapes a team name carrying markup", () => {
    const boshaft = buildRegistrierungBestaetigungEmail({ ...LINK_DATEN, teamName: '<img src=x onerror="alert(1)">' });

    assert.doesNotMatch(boshaft.html, /<img src=x/, "a typed team name reaches the card as markup");
    assert.match(boshaft.html, /&lt;img src=x/, "the escaped form is not in the card either, so this case compares nothing");
  });
});

describe("what the confirmation link's own message says", () => {
  const MAIL = MESSAGES.bestaetigung;

  it("carries the link in both branches, and the press points at it", () => {
    assert.ok(MAIL.text.includes(LINK), "the text branch carries no link at all");
    assert.ok(MAIL.html.includes(`href="${LINK}"`), "the card's control points somewhere other than the link");
    // A reader whose client renders no button copies the address, which is why the card spells it out
    // as well as linking it.
    assert.equal((MAIL.html.match(/beispiel-eins/g) ?? []).length, 3, "the card stops spelling the address beside the button");
  });

  /* The number is the sweep's, mirrored: a message naming a different one tells a pupil a deadline
     the erasure does not keep. */
  it("names the deadline it was handed rather than a word of its own", () => {
    const anders = buildRegistrierungBestaetigungEmail({ ...LINK_DATEN, fristTage: 3 });

    assert.match(MAIL.text, new RegExp(`innerhalb von ${String(FRIST_TAGE)} Tagen`), "the message states no deadline");
    assert.match(anders.text, /innerhalb von 3 Tagen/, "the message states a deadline of its own rather than the constant's");
    assert.doesNotMatch(MAIL.text, /sieben Tagen/, "the deadline is hand-typed beside the constant it is meant to mirror");
  });

  it("says what the press is for, which is the whole of why a link was mailed", () => {
    assert.match(MAIL.text, /Geburtsdatum/, "the message never says what the page will ask for");
    assert.match(MAIL.text, /Kader/, "the message never says what the confirmation unlocks");
  });

  /* The first contact that reaches the address itself, so Art. 21(4) DSGVO asks the objection here,
     apart from every other piece of information. */
  it("states the objection in a paragraph of its own, in both parts", () => {
    assert.match(
      MAIL.html,
      /<p\b[^>]*>Der Verarbeitung Deiner Angaben für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner besonderen Situation ergeben \(Art\. 21 DSGVO\); eine formlose E-Mail an <a href="mailto:[^"]+"[^>]*>[^<]+<\/a> genügt\.<\/p>/,
      "the card carries no objection of its own",
    );
    assert.match(
      MAIL.text,
      /\n\nDer Verarbeitung Deiner Angaben für den Spielbetrieb [^\n]+ genügt\.\n\n/,
      "the text part carries no objection of its own",
    );
  });
});

describe("what the sweep's reminder says that the first message did not", () => {
  const MAIL = MESSAGES.erinnerung;

  /* A reminder reading like a fresh request invites a reader to believe the clock restarted; the
     erasure happens on the day the first message named. */
  it("says the deadline has not moved", () => {
    assert.match(MAIL.text, /verschiebt sie nicht/, "the reminder lets a reader believe the deadline moved with it");
  });

  it("keeps the first link working beside the one it carries", () => {
    assert.match(MAIL.text, /erste[nr]? E-Mail/, "the reminder never says the first link still works");
    assert.ok(MAIL.text.includes(LINK), "the reminder carries no link of its own");
  });
});

describe("what the season-end note says after the row is gone", () => {
  const MAIL = MESSAGES.saisonende;

  /* The record it is about is gone by the time this goes out, so a control pointing at one answers
     its reader with a dead link — and a token in a message about a deletion opens nothing. */
  it("carries no confirmation link and no token", () => {
    assert.doesNotMatch(MAIL.html, /token=/, "the note carries a token for a row that is gone");
    assert.doesNotMatch(MAIL.text, /token=/, "the note's text branch carries a token");
    assert.ok(MAIL.html.includes(`href="${ORIGIN}"`), "the note's one control points somewhere other than the league's landing");
  });

  it("says that the deletion has happened rather than that it will", () => {
    assert.match(MAIL.text, /gelöscht/, "the note never says what happened");
    assert.match(MAIL.text, /Du musst nichts tun/, "the note asks a reader to act on something they cannot change");
    assert.match(MAIL.text, /wieder registrieren/, "the note leaves a returning pupil no way back");
  });
});
