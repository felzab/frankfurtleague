import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import type { BewerbungAbsageData, BewerbungEingangData, BewerbungZusageData } from "./bewerbungEmail.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { buildBewerbungAbsageEmail, buildBewerbungEingangEmail, buildBewerbungZusageEmail } = await import("./bewerbungEmail.ts");
const { KONTAKT_EMAIL, SITE_URL } = await import("./brand.ts");

/**
 * The markup branch reduced to the facts a reader ends up with. Lets a fact be checked as a fact in
 * both branches instead of as one hand-written substring per branch, which is how a pair drifts
 * apart unnoticed.
 */
function readable(html: string): string {
  return (
    html
      // Element and contents both: tag-stripping alone would leave the rules standing as sentences.
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&amp;", "&")
      .replace(/\s+/g, " ")
      // The space this stripper itself put in front of the punctuation that follows an inline link.
      // Undone here rather than left in, so a sentence can be asserted as the reader meets it.
      .replace(/\s+([,.;:!?])/g, "$1")
      .trim()
  );
}

/** The text branch on the same terms, so a comparison between the two is not a comparison of line wrapping. */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The module as text, for the claims about its own shape that no return value carries. */
const MODULE_SOURCE = readFileSync(path.resolve(import.meta.dirname, "bewerbungEmail.ts"), "utf8");

/** Restated, never imported: a colour checked against its own source moves with it. Asserted below to be the module's. */
const BRAND_COLOR = "#82181a";

/** The panel, which stands between the heading and the first prose paragraph. Its position is part of what it is. */
function faktenBereich(html: string): string {
  const nachHeading = html.slice(html.indexOf("</h1>"));

  return nachHeading.slice(0, nachHeading.indexOf("<p "));
}

/** The one stylesheet, contents included -- the only part of a message not stated inline. */
function stylesheet(html: string): string {
  return html.slice(html.indexOf("<style"), html.indexOf("</style>"));
}

/** The shared shell as text: the palette it declares is pinned against `globals.css` in its own test. */
const SHELL_SOURCE = readFileSync(path.resolve(import.meta.dirname, "emailShell.ts"), "utf8");

/** The controls, which stand alone between the rule that sets them off and the one above the close. */
function steuerBereich(html: string): string {
  const erste = html.indexOf("<hr");

  return html.slice(erste, html.indexOf("<hr", erste + 1));
}

/** Everything the panel left to prose, which is where a fact stated explicitly must no longer also sit. */
function proseBereich(html: string): string {
  const nachHeading = html.slice(html.indexOf("</h1>"));

  return nachHeading.slice(nachHeading.indexOf("<p "), nachHeading.indexOf("<hr"));
}

/**
 * The panel read back as the label-and-value pairs a reader sees. Rows are matched without nesting,
 * so the wrapper cell that carries the panel's own spacing is stepped over rather than swallowed.
 */
function faktRows(html: string): Map<string, string> {
  // Stripped so the keys stay the nouns the text branch prints; a missing colon is its own assertion.
  const label = (cell: string | undefined): string => (cell ?? "").replace(/:$/, "");

  const rows = [...faktenBereich(html).matchAll(/<tr>((?:(?!<tr[ >])[\s\S])*?)<\/tr>/g)].map((row) =>
    [...(row[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => readable(cell[1] ?? "")),
  );

  const fakten = new Map<string, string>();
  let offen: string | null = null;
  for (const cells of rows) {
    // Two cells are a row of the label column and the value column; a single one is half of the
    // full-width pair a long value gets, so it is held until its other half arrives.
    if (cells.length === 2) fakten.set(label(cells[0]), cells[1] ?? "");
    else if (cells.length === 1 && offen === null) offen = label(cells[0]);
    else if (cells.length === 1) {
      fakten.set(offen ?? "", cells[0] ?? "");
      offen = null;
    }
  }

  return fakten;
}

/** A name carrying every character `escapeHtml` covers, so an unescaped one lands inside the markup. */
const HOSTILE_NAME = `IGS <script>"Süd" & 'Nord'`;

/**
 * A value whose own line reads as RFC 3676's signature delimiter. Unstuffed, a client folds there and
 * hides every line below it -- in the decline, the stated reason and the whole footer.
 */
const DELIMITER_VALUE = "Erste Zeile\n-- \nZweite Zeile";

/* Typed, so a field added to either interface has to be added here too and reaches the hostile sweep
   below on the same edit rather than when somebody remembers it. */
const ZUSAGE = {
  teamName: "Ernst-Reuter-Schule",
  saisonId: "2627",
  rollenText: "Ansprechperson",
  gruppe: "B",
  trikotFarbeLabel: "Hellgrün",
  wunschgegner: "Wöhlerschule",
} satisfies BewerbungZusageData;
const ABSAGE = {
  teamName: "Ernst-Reuter-Schule",
  saisonId: "2627",
  rollenText: "Stellvertretung",
  grund: "Die Saison ist voll: 16 Teams stehen schon fest.",
} satisfies BewerbungAbsageData;
/* The season and the reader's own seat. The receipt goes out unprompted to an address nobody has
   confirmed, so nothing submitted ABOUT ANYBODY ELSE rides along — which is why this fixture holds
   two fields and not five. */
const EINGANG = {
  saisonId: "2627",
  rollenText: "Ansprechperson",
} satisfies BewerbungEingangData;

/**
 * One fixture per interpolated string, each carrying the hostile value in a different field. Read
 * off the fixture rather than written out per field, so a field added tomorrow reaches the sweep on
 * the same edit.
 */
function hostileVariants<Data extends Record<string, string | null>>(
  data: Data,
  branch: string,
  value: string = HOSTILE_NAME,
): { field: string; data: Data }[] {
  return Object.keys(data)
    .filter((field) => typeof data[field] === "string")
    .map((field) => ({ field: `${branch}.${field}`, data: { ...data, [field]: value } }));
}

/**
 * Spelled out here rather than imported from the module: a sentence checked against its own source
 * moves with it, which is how five mutations to fixed copy stayed green while every interpolated
 * value was covered.
 */
const WEBSITE_SENTENCE = `Spielplan, Tabelle und Ergebnisse veröffentlichen wir auf ${SITE_URL}, sobald die Saison startet.`;

/**
 * Spelled out for the reason above, and WHOLE: what this sentence must not promise is carried by the
 * half a substring check would drop, so „wir versuchen“ could be slipped in beside a passing assertion.
 */
const WUNSCHGEGNER_SENTENCE = `Als Wunschgegner für den ersten Spieltag haben wir ${ZUSAGE.wunschgegner} notiert; über die Paarungen entscheidet der Spielplan.`;

/** The second control, the same on all three: one page that is a dead end for none of their readers. */
const LIGA_AKTION = { label: "Laufende Saison", href: `${SITE_URL}/dashboard` };

/** What each message states about who it reached: the receipt goes to one seat, the two decisions to three. */
const EMPFAENGER_SATZ = {
  kontaktpersonen: "Diese E-Mail geht an die Kontaktpersonen der Bewerbung.",
  ansprechperson: "Diese E-Mail geht nur an die Ansprechperson der Bewerbung.",
};

/** The closing sentences of a message that reached all three seats, which is either decision. */
const FOOTER_SENTENCES = [EMPFAENGER_SATZ.kontaktpersonen, "Antworten an die Absenderadresse liest niemand."];

/** Spelled out here for the reason above: copy checked against its own source moves with it. */
const IGNORIER_SATZ =
  "Du weißt nichts von einer Bewerbung bei der Frankfurt-League? Dann ignoriere diese E-Mail einfach. Für Dich ist nichts zu tun.";

/** The text branch's close as a block, the delimiter included: its order is part of what it says. */
const textFooter = (empfaenger: keyof typeof EMPFAENGER_SATZ): string =>
  ["-- ", EMPFAENGER_SATZ[empfaenger], `Antworten an die Absenderadresse liest niemand. Schreibe uns an ${KONTAKT_EMAIL}.`].join("\n");

/**
 * The three messages, each beside the close it must carry and the destination its second control
 * takes. Paired here rather than per case, so no sweep below can check one message against another's.
 */
const MELDUNGEN = [
  { name: "Zusage", build: () => buildBewerbungZusageEmail(ZUSAGE), empfaenger: "kontaktpersonen", saisonId: ZUSAGE.saisonId },
  { name: "Absage", build: () => buildBewerbungAbsageEmail(ABSAGE), empfaenger: "kontaktpersonen", saisonId: ABSAGE.saisonId },
  { name: "Eingang", build: () => buildBewerbungEingangEmail(EINGANG), empfaenger: "ansprechperson", saisonId: EINGANG.saisonId },
] as const;

const alleMeldungen = () => MELDUNGEN.map((meldung) => ({ ...meldung, mail: meldung.build(), footer: textFooter(meldung.empfaenger) }));

describe("buildBewerbungZusageEmail", () => {
  it("states its facts in the panel, in the order they are laid out", () => {
    assert.deepEqual(
      [...faktRows(buildBewerbungZusageEmail(ZUSAGE).html)],
      [
        ["Entscheidung", "Zusage"],
        ["Team", ZUSAGE.teamName],
        ["Saison", ZUSAGE.saisonId],
        ["Gruppe", ZUSAGE.gruppe],
        ["Trikotfarbe", ZUSAGE.trikotFarbeLabel],
        // The one row that differs per reader: three people are told one decision, each their own place in it.
        ["Eingetragen als", ZUSAGE.rollenText],
      ],
    );
  });

  it("leaves the prose the sentences the panel does not carry, and none it does", () => {
    const prose = readable(proseBereich(buildBewerbungZusageEmail(ZUSAGE).html));

    assert.ok(prose.includes(`${ZUSAGE.teamName} ist für die Saison ${ZUSAGE.saisonId} der Frankfurt-League aufgenommen.`));
    assert.ok(prose.includes("Wir freuen uns auf die gemeinsame Saison."));
    assert.ok(prose.includes(WEBSITE_SENTENCE));
    // Stated once. A fact restated in prose is the burial the panel exists to undo.
    for (const gestellt of ["Gruppe", "Trikotfarbe", "Eingetragen als"]) {
      assert.ok(!prose.includes(gestellt), `„${gestellt}“ is stated in the panel and again in the prose`);
    }
  });

  it("carries every fact in both branches", () => {
    const mail = buildBewerbungZusageEmail(ZUSAGE);

    for (const fact of [
      ZUSAGE.teamName,
      `Zusage für die Saison ${ZUSAGE.saisonId}`,
      KONTAKT_EMAIL,
      `${ZUSAGE.teamName} ist für die Saison ${ZUSAGE.saisonId} der Frankfurt-League aufgenommen.`,
      "Wir freuen uns auf die gemeinsame Saison.",
      WEBSITE_SENTENCE,
      ...FOOTER_SENTENCES,
    ]) {
      assert.ok(readable(mail.html).includes(fact), `HTML branch is missing: ${fact}`);
      assert.ok(flat(mail.text).includes(fact), `text branch is missing: ${fact}`);
    }
  });

  it("carries its own decision word in the subject", () => {
    assert.equal(buildBewerbungZusageEmail(ZUSAGE).subject, `Zusage: Frankfurt-League, Saison ${ZUSAGE.saisonId}`);
  });

  it("states that no kit colour is set rather than naming one", () => {
    const mail = buildBewerbungZusageEmail({ ...ZUSAGE, trikotFarbeLabel: null });

    assert.equal(faktRows(mail.html).get("Trikotfarbe"), "noch nicht festgelegt");
    assert.ok(flat(mail.text).includes("Trikotfarbe: noch nicht festgelegt"));
    for (const branch of [readable(mail.html), flat(mail.text)]) {
      assert.ok(!branch.includes(ZUSAGE.trikotFarbeLabel), "a colour was named where none is assigned");
      // The group survives the colour being absent: an absent value is a row like any other.
      assert.ok(branch.includes(ZUSAGE.gruppe));
    }
  });

  /* The draw runs AFTER the decision this message states, so the sentence receipts the wish and hands
     the outcome to the Spielplan. Asserted whole, in the prose, and in both branches. */
  it("carries a named opponent as a wish rather than as a fixture", () => {
    const mail = buildBewerbungZusageEmail(ZUSAGE);

    assert.ok(flat(readable(proseBereich(mail.html))).includes(WUNSCHGEGNER_SENTENCE), "the markup branch lost the wish");
    assert.ok(flat(mail.text).includes(WUNSCHGEGNER_SENTENCE), "the text branch lost the wish");
    // It stands between the acceptance and where the Spielplan will be published, which is what makes
    // „entscheidet der Spielplan“ resolve for the reader rather than trail off.
    assert.ok(mail.text.indexOf(WUNSCHGEGNER_SENTENCE) < mail.text.indexOf(WEBSITE_SENTENCE), "the wish fell below the website sentence");
  });

  it("says nothing about an opponent where the school named none", () => {
    const ohne = buildBewerbungZusageEmail({ ...ZUSAGE, wunschgegner: null });

    for (const branch of [flat(readable(ohne.html)), flat(ohne.text)]) {
      assert.ok(!branch.includes("Wunschgegner"), "the message names the field a school left empty");
      assert.ok(!branch.includes(ZUSAGE.wunschgegner), "an opponent was named where none was submitted");
    }
    // Silence, not a gap: the paragraphs the sentence sits between meet exactly as they do in a
    // message that never carried one, so the omission leaves nothing for a reader to wonder about.
    assert.ok(ohne.text.includes(`Wir freuen uns auf die gemeinsame Saison.\n\n${WEBSITE_SENTENCE}`), "the absent sentence left a blank line");
    assert.ok(!/<p [^>]*>\s*<\/p>/.test(ohne.html), "the absent sentence left an empty paragraph");

    /* An absent key, an explicit null and a blank are one case. Which of the three reaches this module
       is the payload's business, and a renderer that told them apart would state a wish per shape. */
    assert.equal(buildBewerbungZusageEmail({ ...ZUSAGE, wunschgegner: undefined }).text, ohne.text);
    assert.equal(buildBewerbungZusageEmail({ ...ZUSAGE, wunschgegner: "  \n " }).text, ohne.text);
  });

  /* The emphasis grade marks the one fact a paragraph exists to carry, and this paragraph exists to
     carry that the draw has not run. A club set in it is read as the fixture, by a reader who skims. */
  it("leaves a named opponent unemphasised, unlike the team it accepts", () => {
    const emphasised = [...buildBewerbungZusageEmail(ZUSAGE).html.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g)].map(
      (match) => match[1] ?? "",
    );

    assert.ok(
      emphasised.some((inner) => inner.includes(ZUSAGE.teamName)),
      "the team name lost its emphasis, so this test proves nothing",
    );
    assert.ok(!emphasised.some((inner) => inner.includes(ZUSAGE.wunschgegner)), "the wish is shouted as loudly as the decision");
  });

  it("escapes the team name in the markup branch and leaves the text branch alone", () => {
    const mail = buildBewerbungZusageEmail({ ...ZUSAGE, teamName: HOSTILE_NAME });

    assert.ok(!mail.html.includes("<script>"), "an unescaped tag reached the markup");
    assert.ok(mail.html.includes("&lt;script&gt;"));
    assert.ok(mail.html.includes("&quot;Süd&quot;"));
    assert.ok(mail.html.includes("&amp;"));
    assert.ok(mail.html.includes("&#39;Nord&#39;"));

    assert.ok(mail.text.includes(HOSTILE_NAME), "the text branch must carry the name as written");
    // Decoding the markup back returns the same name, so escaping changed the encoding and not the fact.
    assert.ok(readable(mail.html).includes(HOSTILE_NAME));
  });
});

describe("buildBewerbungAbsageEmail", () => {
  it("states its facts in the panel, the stated reason last and in full", () => {
    assert.deepEqual(
      [...faktRows(buildBewerbungAbsageEmail(ABSAGE).html)],
      [
        ["Entscheidung", "Absage"],
        ["Team", ABSAGE.teamName],
        ["Saison", ABSAGE.saisonId],
        // Identification and not a verdict: a decline is the message a fake application sends to an
        // address that never applied, and its reader has to be able to place it.
        ["Eingetragen als", ABSAGE.rollenText],
        ["Angegebener Grund", ABSAGE.grund],
      ],
    );
  });

  it("leaves the prose the sentences the panel does not carry, and none it does", () => {
    const prose = readable(proseBereich(buildBewerbungAbsageEmail(ABSAGE).html));

    assert.ok(prose.includes(`Danke, dass ${ABSAGE.teamName} sich für die Saison ${ABSAGE.saisonId} der Frankfurt-League beworben hat.`));
    assert.ok(prose.includes("Für diese Saison können wir das Team nicht aufnehmen."));
    assert.ok(prose.includes("Die Entscheidung betrifft diese Bewerbung, nicht die Schule und nicht die Menschen dahinter."));
    for (const gestellt of ["Angegebener Grund", "Eingetragen als", ABSAGE.grund]) {
      assert.ok(!prose.includes(gestellt), `„${gestellt}“ is stated in the panel and again in the prose`);
    }
  });

  it("carries every fact in both branches", () => {
    const mail = buildBewerbungAbsageEmail(ABSAGE);

    for (const fact of [
      ABSAGE.teamName,
      `Absage für die Saison ${ABSAGE.saisonId}`,
      ABSAGE.grund,
      KONTAKT_EMAIL,
      `Danke, dass ${ABSAGE.teamName} sich für die Saison ${ABSAGE.saisonId} der Frankfurt-League beworben hat.`,
      "Angegebener Grund",
      "Für diese Saison können wir das Team nicht aufnehmen.",
      "Die Entscheidung betrifft diese Bewerbung, nicht die Schule und nicht die Menschen dahinter.",
      ...FOOTER_SENTENCES,
    ]) {
      assert.ok(readable(mail.html).includes(fact), `HTML branch is missing: ${fact}`);
      assert.ok(flat(mail.text).includes(fact), `text branch is missing: ${fact}`);
    }
  });

  it("carries its own decision word in the subject, and never the free text", () => {
    const mail = buildBewerbungAbsageEmail(ABSAGE);

    assert.equal(mail.subject, `Absage: Frankfurt-League, Saison ${ABSAGE.saisonId}`);
    assert.ok(!mail.subject.includes(ABSAGE.grund));
  });

  it("carries the stated reason verbatim, escaped in the markup branch only", () => {
    const grund = `Kein Platz: <b>zu spät</b> & "unvollständig"`;
    const mail = buildBewerbungAbsageEmail({ ...ABSAGE, grund: grund });

    assert.ok(!mail.html.includes("<b>"), "an unescaped tag reached the markup");
    assert.ok(mail.html.includes("&lt;b&gt;zu spät&lt;/b&gt;"));
    assert.equal(flat(mail.text).includes(grund), true);
    assert.ok(readable(mail.html).includes(grund));
  });

  it("keeps a multi-line reason on separate lines in both branches", () => {
    const grund = "Zwei Gründe:\n- Die Gruppen sind besetzt.\n- Die Frist war am 01.03.";
    const mail = buildBewerbungAbsageEmail({ ...ABSAGE, grund: grund });

    // Folded into one line, those leading hyphens would stand between spaces in front of a school,
    // the shape `docs/frontend/spec.md` §1.12 bans -- and no `copy-dash` sweep can see it.
    assert.ok(mail.html.includes("Zwei Gründe:<br />- Die Gruppen sind besetzt.<br />- Die Frist war am 01.03."));
    for (const line of grund.split("\n")) assert.ok(mail.text.includes(line), `the text branch folded: ${line}`);
  });

  it("folds a CRLF reason to one break rather than two", () => {
    const mail = buildBewerbungAbsageEmail({ ...ABSAGE, grund: "Erste Zeile\r\nZweite Zeile" });

    assert.ok(mail.html.includes("Erste Zeile<br />Zweite Zeile"));
  });

  it("states the reason without an emphasis grade", () => {
    const mail = buildBewerbungAbsageEmail(ABSAGE);
    const emphasised = [...mail.html.matchAll(/<strong[^>]*>(.*?)<\/strong>/g)].map((match) => match[1] ?? "");

    // The emphasis grade marks the one fact a row or a paragraph exists to carry, and a reason runs
    // to 1000 characters. The team name is asserted too, so a message that emphasised nothing could
    // not pass this.
    assert.ok(
      emphasised.some((inner) => inner.includes(ABSAGE.teamName)),
      "the team name lost its emphasis",
    );
    assert.ok(!emphasised.some((inner) => inner.includes(ABSAGE.grund)), "the reason is shouted");
  });

  it("declines the application without judging the school", () => {
    const mail = buildBewerbungAbsageEmail(ABSAGE);

    for (const branch of [readable(mail.html), flat(mail.text)]) {
      assert.ok(branch.includes("Die Entscheidung betrifft diese Bewerbung, nicht die Schule"));
    }
  });
});

describe("buildBewerbungEingangEmail", () => {
  it("states its facts in the panel, and nothing of what was submitted", () => {
    assert.deepEqual(
      [...faktRows(buildBewerbungEingangEmail(EINGANG).html)],
      [
        ["Status", "Bewerbung eingegangen"],
        ["Saison", EINGANG.saisonId],
        // Why it reached THIS reader, who is the only one it is sent to.
        ["Eingetragen als", EINGANG.rollenText],
      ],
    );
  });

  /* The SENTENCES and not only the values: a heading carrying the season lets the body lose the one
     line that says what happened, and the message then reads as an announcement about nothing. */
  it("carries every fact in both branches", () => {
    const mail = buildBewerbungEingangEmail(EINGANG);

    for (const fakt of [
      `Bewerbung für die Saison ${EINGANG.saisonId}`,
      `Deine Bewerbung für die Saison ${EINGANG.saisonId} der Frankfurt-League ist bei uns eingegangen.`,
      "Danke für die Anmeldung Deines Teams.",
      "melden uns bei allen drei Kontaktpersonen",
      "Du musst nichts weiter tun.",
      WEBSITE_SENTENCE,
    ]) {
      assert.ok(flat(readable(mail.html)).includes(fakt), `the HTML branch lost „${fakt}“`);
      assert.ok(flat(mail.text).includes(fakt), `the text branch lost „${fakt}“`);
    }
  });

  it("names the season in the subject, and nothing of what was submitted", () => {
    const mail = buildBewerbungEingangEmail(EINGANG);

    assert.equal(mail.subject, `Bewerbung eingegangen: Frankfurt-League, Saison ${EINGANG.saisonId}`);
  });

  /* The one fact the message exists to hand over. Without the emphasis it reads as a paragraph about
     the league rather than as the confirmation somebody is waiting for. */
  it("emphasises that the application arrived", () => {
    const emphasised = [...buildBewerbungEingangEmail(EINGANG).html.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g)].map((match) =>
      flat(match[1] ?? ""),
    );

    assert.ok(
      emphasised.some((inner) => inner.includes("bei uns eingegangen")),
      "the arrival is not the emphasised fact",
    );
  });
});

describe("all three messages", () => {
  it("state the same facts in both branches", () => {
    for (const { name, mail } of alleMeldungen()) {
      const fakten = faktRows(mail.html);

      assert.ok(fakten.size >= 3, `${name} states no panel of facts at all, so this test proves nothing`);
      for (const [label, value] of fakten) {
        assert.ok(flat(mail.text).includes(`${label}: ${value}`), `${name}'s text branch lost „${label}: ${value}“`);
      }
    }
  });

  it("set every „Saison NNNN“ in the brand colour, and in the panel the year alone", () => {
    assert.ok(SHELL_SOURCE.includes(`const BRAND_COLOR = "${BRAND_COLOR}";`), "the brand colour moved and this test did not move with it");

    for (const { name, mail, saisonId } of alleMeldungen()) {
      const koerper = mail.html.slice(mail.html.indexOf("</head>"));
      const stellen = [...koerper.matchAll(new RegExp(`Saison ${saisonId}`, "g"))].map((treffer) => treffer.index);

      assert.ok(stellen.length >= 2, `${name} names the season at most once in its body, so this test proves nothing`);
      for (const stelle of stellen) {
        assert.ok(
          koerper.slice(0, stelle).endsWith(`<strong class="fl-brand" style="color:${BRAND_COLOR};">`),
          `${name} states the season uncoloured`,
        );
      }

      /* The panel splits the phrase across two cells: „Saison“ is a category name like „Team“ or
         „Gruppe“ and is set like one, and the colour marks the year -- the half that is the fact. */
      const zeile = [...faktenBereich(mail.html).matchAll(/<tr>((?:(?!<tr[ >])[\s\S])*?)<\/tr>/g)]
        .map((treffer) => treffer[1] ?? "")
        .find((row) => row.includes(">Saison:</td>"));

      assert.ok(zeile !== undefined, `${name}'s panel has no season row`);
      assert.equal([...(zeile ?? "").matchAll(new RegExp(`color:${BRAND_COLOR};`, "g"))].length, 1, `${name} brands its season row twice`);

      const [beschriftung = "", wert = ""] = [...(zeile ?? "").matchAll(/<td[^>]*>/g)].map((treffer) => treffer[0]);
      assert.ok(!beschriftung.includes(BRAND_COLOR) && !beschriftung.includes("fl-brand"), `${name} brands the „Saison“ label`);
      assert.ok(wert.includes(BRAND_COLOR) && wert.includes("fl-brand"), `${name} leaves the season's year uncoloured`);
    }
  });

  /* A stranger can type anybody's address into a public form, so every one of these can reach a
     reader who never applied. Both branches, because a reader is shown one of them. */
  it("tell a reader who never applied that the message can be ignored", () => {
    for (const { mail } of alleMeldungen()) {
      assert.ok(flat(readable(mail.html)).includes(IGNORIER_SATZ), "the markup branch lost the note");
      assert.ok(flat(mail.text).includes(IGNORIER_SATZ), "the text branch lost the note");
      // Once: `renderHtml` carries it for every message, and a message adding its own would say it twice.
      assert.equal(mail.text.split(IGNORIER_SATZ).length - 1, 1, "the text branch states the note twice");
    }
  });

  /* Where it stands is what decides whether the reader it exists for reaches it: last in the body,
     above the rule the controls stand under, and never down in the grey close nobody reads. */
  it("place that note last in the body, quieter than the prose but out of the small print", () => {
    for (const { name, mail, empfaenger, footer } of alleMeldungen()) {
      const ab = mail.html.slice(mail.html.indexOf(IGNORIER_SATZ));
      const trenner = ab.indexOf("<hr");

      assert.ok(trenner > 0 && ab.indexOf("mailto:") > trenner, `${name}'s note no longer stands above the separated controls`);
      assert.ok(!ab.slice(0, trenner).includes("<p "), `${name} puts a paragraph between the note and the controls`);

      // Its own grade: body copy one step down, and never the small print the close is set in.
      const grade = (satz: string): string => {
        const auf = mail.html.lastIndexOf("<p ", mail.html.indexOf(satz));
        return mail.html.slice(auf, mail.html.indexOf(">", auf));
      };

      assert.ok(grade(IGNORIER_SATZ).includes("font-size:13px"), `${name}'s note is not set in the aside grade`);
      assert.ok(grade(EMPFAENGER_SATZ[empfaenger]).includes("font-size:12px"), `${name}'s close is not set in the small print`);
      // The text branch closes on the footer, so the note stands above the signature delimiter.
      assert.ok(mail.text.indexOf(IGNORIER_SATZ) < mail.text.indexOf(footer), "the note fell below the signature delimiter");
    }
  });

  /* Two ways on, both reachable without typing anything: the contact address, and the one page this
     particular message sends its reader to. */
  it("offer two controls, both centred, under a rule of their own", () => {
    for (const { name, mail } of alleMeldungen()) {
      const bereich = steuerBereich(mail.html);
      const ziele = [...bereich.matchAll(/<a href="([^"]+)"/g)].map((treffer) => treffer[1] ?? "");

      assert.deepEqual(ziele, [`mailto:${KONTAKT_EMAIL}`, LIGA_AKTION.href], `${name} does not offer the two controls it should`);
      // A cell that is not centred puts its pill against the card's left edge while the other floats.
      assert.equal([...bereich.matchAll(/<td align="center"/g)].length, 2, `${name} leaves a control uncentred`);
      assert.ok(mail.text.includes(LIGA_AKTION.href), `${name}'s text branch does not offer the second destination`);
    }
  });

  /* One destination and one label for all three, so no reader is sent somewhere their own message
     makes wrong — the receipt least of all, which says there is nothing left to do. */
  it("send every reader to the same one page, under the name the site gives it", () => {
    const steuer = alleMeldungen().map(({ name, mail }) => ({
      name: name,
      controls: [...steuerBereich(mail.html).matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((treffer) => `${treffer[1]} ${treffer[2]}`),
    }));

    for (const { name, controls } of steuer) {
      assert.deepEqual(controls, steuer[0]?.controls, `${name} offers different controls than the acceptance does`);
    }
    // Named as `BewerbungView.tsx :: KOPF_LINKS` names it: a third name for one page is a third page
    // as far as a reader is concerned.
    for (const { name, mail } of alleMeldungen()) {
      assert.ok(mail.html.includes(`>${LIGA_AKTION.label}</a>`), `${name} gives the league page a name of its own`);
      assert.ok(mail.text.includes(`${LIGA_AKTION.label}: ${LIGA_AKTION.href}`), `${name}'s text branch renames it`);
    }
  });

  /* Every label reads „Name:“ and every pair shares one type grade. A 13px label beside a 15px
     value is top-aligned on two different line boxes, which sets their baselines ~2px apart -- the
     column looks broken while the markup is fine. */
  it("close every panel label with a colon and set it in the value's own grade", () => {
    for (const { name, mail } of alleMeldungen()) {
      const rows = [...faktenBereich(mail.html).matchAll(/<tr>((?:(?!<tr[ >])[\s\S])*?)<\/tr>/g)].map((treffer) => treffer[1] ?? "");
      const cells = rows.flatMap((row) => [...row.matchAll(/<td[^>]*style="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)]);

      assert.ok(cells.length >= 6, `${name} renders no panel cells, so this test proves nothing`);
      /* Read off `faktRows`, which strips the colon to key its map: a label rendered without one
         leaves the raw cell equal to the bare key, so this cannot pass by skipping the cell. */
      const roh = cells.map(([, , inhalt]) => readable(inhalt ?? ""));
      for (const label of faktRows(mail.html).keys()) {
        assert.ok(roh.includes(`${label}:`), `${name} renders „${label}“ without its colon`);
      }
      // One grade for both halves, which is what puts their first baselines on the same line.
      for (const [, stil] of cells) {
        assert.ok((stil ?? "").includes("font-size:15px;line-height:1.6;"), `${name} mixes type grades inside one row`);
      }
    }
  });

  /* A percentage on the label cell is what makes the pairs share one column: without it every row
     sizes to its own content and the values start at a different x per row. */
  it("give the label column one width every paired row shares", () => {
    for (const { name, mail } of alleMeldungen()) {
      const paare = [...faktenBereich(mail.html).matchAll(/<td width="(\d+%)" valign="top"/g)].map((treffer) => treffer[1]);

      assert.ok(paare.length >= 2, `${name} has no paired rows, so this test proves nothing`);
      assert.equal(new Set(paare).size, 1, `${name} gives its rows different label widths`);
      // Top, not middle: a value that wraps must leave its label on the first line.
      assert.ok(!faktenBereich(mail.html).includes(`valign="middle"`), `${name} centres a cell that may wrap`);
    }
  });

  /* Outlook has no flexbox, so a row of buttons is a row of cells: one `<tr>`, with a spacer cell
     between the two rather than a margin. What happens below the card's width is the shell's. */
  it("set the two controls side by side in one row", () => {
    for (const { name, mail } of alleMeldungen()) {
      const bereich = steuerBereich(mail.html);

      assert.equal([...bereich.matchAll(/<tr>/g)].length, 1, `${name} does not hold its controls in one row`);
      assert.equal([...bereich.matchAll(/<td /g)].length, 3, `${name} is not a button, a gap and a button`);
    }
  });

  /* `escapeHtml` guards an HTML context; a stylesheet is not one, and CSS needs different escaping.
     Rendering it byte-identical for every input is what keeps that from ever mattering. */
  it("keep every caller's value out of the stylesheet", () => {
    const alle = [
      ...alleMeldungen().map(({ mail }) => mail),
      ...hostileVariants(ZUSAGE, "Zusage").map((v) => buildBewerbungZusageEmail(v.data)),
      ...hostileVariants(ABSAGE, "Absage").map((v) => buildBewerbungAbsageEmail(v.data)),
      ...hostileVariants(EINGANG, "Eingang").map((v) => buildBewerbungEingangEmail(v.data)),
    ];

    assert.ok(alle.length > 3, "no hostile fixture was built, so this test proves nothing");
    for (const mail of alle) assert.equal(stylesheet(mail.html), stylesheet(alle[0]?.html ?? ""), "a value reached the stylesheet");
  });

  it("offer the one contact route the product actually has", () => {
    for (const { mail } of alleMeldungen()) {
      assert.ok(mail.html.includes(`href="mailto:${KONTAKT_EMAIL}"`));
      assert.ok(mail.text.includes(KONTAKT_EMAIL));
    }
  });

  it("state the contact address once in the text branch", () => {
    // In HTML the two slots are a button and a footer note; the text branch has only the note.
    for (const { mail } of alleMeldungen()) {
      assert.equal(mail.text.split(KONTAKT_EMAIL).length - 1, 1, "the text branch repeats the address");
    }
  });

  /* An address a reader has to select and paste is not a route, and one marked by colour alone is not
     a link to a reader who cannot see the colour. */
  it("make every address standing in prose a marked link", () => {
    for (const { name, mail } of alleMeldungen()) {
      for (const absatz of mail.html.matchAll(/<p [^>]*>([\s\S]*?)<\/p>/g)) {
        const inner = absatz[1] ?? "";
        if (!inner.includes(SITE_URL) && !inner.includes(KONTAKT_EMAIL)) continue;

        assert.match(inner, /<a href="[^"]+"[^>]*>[^<]+<\/a>/, `${name} sets an address in prose without a link`);
        assert.ok(inner.includes("text-decoration:underline"), `${name}'s prose link is marked by colour alone`);
      }
    }
  });

  /* A line naming who ELSE read the message has to be true of the message it closes. Both decisions go
     to all three seats; the receipt goes to the one seat that submitted the form and to nobody else. */
  it("name the readers each message actually reached, and no others", () => {
    for (const { name, mail, empfaenger } of alleMeldungen()) {
      const eigen = EMPFAENGER_SATZ[empfaenger];

      assert.ok(flat(readable(mail.html)).includes(eigen), `${name}'s markup branch does not say who it reached`);
      assert.ok(flat(mail.text).includes(eigen), `${name}'s text branch does not say who it reached`);

      for (const [kreis, satz] of Object.entries(EMPFAENGER_SATZ)) {
        if (kreis === empfaenger) continue;

        assert.ok(!flat(readable(mail.html)).includes(satz), `${name} tells its reader it reached the ${kreis}`);
        assert.ok(!flat(mail.text).includes(satz), `${name}'s text branch tells its reader it reached the ${kreis}`);
      }
    }
  });

  it("close the text branch with RFC 3676's signature delimiter", () => {
    for (const { name, mail, footer } of alleMeldungen()) {
      assert.ok(mail.text.includes("\n-- \n"), "without the trailing space no client folds the footer");
      // As a block: the delimiter opens the footer and each sentence holds its own place, so a pair
      // that traded places is a different footer rather than the same two sentences.
      assert.ok(mail.text.endsWith(`\n${footer}`), `${name}'s text branch no longer closes with its footer, in its order`);
    }
  });

  /* Every value either builder interpolates, one hostile fixture at a time. Written as a sweep rather
     than as a case per field: a fifth field is covered the day it is added, and dropping any one
     `escapeHtml` call fails here. */
  it("escape every value they interpolate into the markup", () => {
    const cases = [
      ...hostileVariants(ZUSAGE, "Zusage").map((variant) => ({ field: variant.field, mail: buildBewerbungZusageEmail(variant.data) })),
      ...hostileVariants(ABSAGE, "Absage").map((variant) => ({ field: variant.field, mail: buildBewerbungAbsageEmail(variant.data) })),
      ...hostileVariants(EINGANG, "Eingang").map((variant) => ({ field: variant.field, mail: buildBewerbungEingangEmail(variant.data) })),
    ];

    assert.ok(cases.length > 0, "no interpolated field was found at all, so this test proves nothing");
    for (const { field, mail } of cases) {
      assert.ok(!mail.html.includes("<script>"), `${field} reaches the markup unescaped`);
      // Decoding the markup back returns the value, so escaping changed the encoding and not the fact.
      assert.ok(readable(mail.html).includes(HOSTILE_NAME), `${field} did not survive escaping as the value written`);
    }
  });

  /* The escaping sweep's counterpart, against the text branch's own hazard: a client folding at a
     value's delimiter line hides every line below it, the whole footer included. */
  it("keep every value they interpolate from opening a second signature block", () => {
    const cases = [
      ...hostileVariants(ZUSAGE, "Zusage", DELIMITER_VALUE).map((variant) => ({
        field: variant.field,
        mail: buildBewerbungZusageEmail(variant.data),
        footer: textFooter("kontaktpersonen"),
      })),
      ...hostileVariants(ABSAGE, "Absage", DELIMITER_VALUE).map((variant) => ({
        field: variant.field,
        mail: buildBewerbungAbsageEmail(variant.data),
        footer: textFooter("kontaktpersonen"),
      })),
      ...hostileVariants(EINGANG, "Eingang", DELIMITER_VALUE).map((variant) => ({
        field: variant.field,
        mail: buildBewerbungEingangEmail(variant.data),
        footer: textFooter("ansprechperson"),
      })),
    ];

    assert.ok(cases.length > 0, "no interpolated field was found at all, so this test proves nothing");
    for (const { field, mail, footer } of cases) {
      assert.equal([...mail.text.matchAll(/^-- $/gm)].length, 1, `${field} stands as a second signature delimiter`);
      /* Content survival, which is what stuffing buys. A field folded onto one line
         (`renderText :: zeile`) has no line left to stuff, so the guarantee is the value still being
         there — the count above proves the stacked field's line WAS stuffed. */
      assert.ok(
        mail.text.includes("Erste Zeile") && mail.text.includes("Zweite Zeile"),
        `${field}'s value was dropped rather than carried, so the reader loses it`,
      );
      assert.ok(mail.text.includes("Zweite Zeile"), `${field} lost the line below its delimiter`);
      assert.ok(mail.text.endsWith(`\n${footer}`), `${field} pushed the footer out of the close`);
      // The markup branch states the same facts, so a value folded away in one branch only is two messages.
      assert.ok(readable(mail.html).includes("Zweite Zeile"), `${field} lost the line below its delimiter in the markup`);
    }
  });

  /* A panel label and the words a heading opens on are the module's own literals today, so no
     rendered message can carry either unescaped and no fixture can reach them. Pinned against the
     source instead, for the day one is derived. */
  it("escape a panel label and a heading as they escape a panel value", () => {
    assert.match(MODULE_SOURCE, /const label = escapeHtml\(fakt\.label\);/, "a panel label is interpolated raw");
    assert.match(MODULE_SOURCE, /ueberschrift: `\$\{escapeHtml\(headingVor\)\}/, "a heading is interpolated raw");
  });

  it("take the site's public origin from the brand rather than spelling one", () => {
    assert.match(
      MODULE_SOURCE,
      /import \{ KONTAKT_EMAIL, SITE_URL \} from "\.\/brand";/,
      "the messages no longer read the origin off the brand",
    );
    assert.ok(!/^const SITE_URL =/m.test(MODULE_SOURCE), "the messages declare an origin of their own beside the brand's");
  });

  it("never hand a reader another message's subject or heading", () => {
    const zusage = buildBewerbungZusageEmail(ZUSAGE);
    const absage = buildBewerbungAbsageEmail(ABSAGE);
    const eingang = buildBewerbungEingangEmail(EINGANG);

    assert.notEqual(zusage.subject, absage.subject);
    assert.ok(!zusage.subject.includes("Absage") && !readable(zusage.html).includes("Absage für die Saison"));
    assert.ok(!absage.subject.includes("Zusage") && !readable(absage.html).includes("Zusage für die Saison"));

    /* The receipt is the one that arrives while nothing has been decided, so a reader who saw either
       decision's wording in it would read a decision the league has not taken. */
    for (const wort of ["Zusage", "Absage", "aufgenommen", "können wir das Team nicht aufnehmen"]) {
      assert.ok(!eingang.subject.includes(wort), `the receipt's subject says „${wort}“`);
      assert.ok(!readable(eingang.html).includes(wort), `the receipt says „${wort}“`);
      assert.ok(!eingang.text.includes(wort), `the receipt's text branch says „${wort}“`);
    }
  });

  /* The one thing that separates this message from the two decisions: it goes out before anybody has
     confirmed the address, so nothing that was typed into the form may ride along in it. */
  it("carry no copy of the submission in the receipt", () => {
    const eingang = buildBewerbungEingangEmail(EINGANG);

    for (const eingetragen of [ZUSAGE.teamName, ZUSAGE.wunschgegner, "erika@beispiel.de", "069 1234567", "Goethe-Gymnasium"]) {
      assert.ok(!readable(eingang.html).includes(eingetragen), `the receipt repeats „${eingetragen}“`);
      assert.ok(!eingang.text.includes(eingetragen), `the receipt's text branch repeats „${eingetragen}“`);
    }
  });
});

/**
 * `docs/frontend/spec.md :: I46`: the text branch sets one fact to the line, so a value carrying a
 * break opens a line of its own — one the reader cannot tell from a fact the league stated.
 */
describe("no value can open a line of its own in the text branch", () => {
  /** The forged fact, in the shape `renderText` writes a real one. */
  /* Fact-SHAPED and never genuine: „Entscheidung: Absage“ is a real row in the decline, so a
     forged line has to be one no message writes. */
  const GEFAELSCHT = "Startgeld: 500 Euro";
  const NAME_MIT_UMBRUCH = `Echte Schule\n${GEFAELSCHT}`;

  /**
   * Whether any line OPENS with the forged fact. `startsWith` rather than an exact match: in the
   * prose the value is followed by the sentence it was interpolated into, so a line equal to the
   * forgery is only the panel's half of it.
   */
  const forgedLine = (text: string): boolean => text.split("\n").some((zeile) => zeile.startsWith(GEFAELSCHT));

  it("folds a name carrying a break onto its own line", () => {
    const zusage = buildBewerbungZusageEmail({ ...ZUSAGE, teamName: NAME_MIT_UMBRUCH });

    assert.ok(!forgedLine(zusage.text), "a submitted name forged a fact line");
    /* Folded, never dropped: the name a school gave is what the message is about, and a renderer
       that silently lost half of it would be a second defect wearing the first one's fix. */
    assert.ok(zusage.text.includes(`Team: Echte Schule ${GEFAELSCHT}`), "the name was not carried onto one line");
  });

  it("folds it in the decline as well, which states the same name", () => {
    const absage = buildBewerbungAbsageEmail({ ...ABSAGE, teamName: NAME_MIT_UMBRUCH });

    assert.ok(!forgedLine(absage.text), "a submitted name forged a fact line in the decline");
  });

  /* The prose states the name too, so guarding the panel alone would leave the same forged line
     standing one paragraph further down. */
  it("folds it in the prose, not only in the panel", () => {
    const zusage = buildBewerbungZusageEmail({ ...ZUSAGE, teamName: NAME_MIT_UMBRUCH });

    assert.equal(zusage.text.split("\n").filter((zeile) => zeile.includes("aufgenommen")).length, 1, "the name split the prose");
    assert.ok(!forgedLine(zusage.text), "the prose carried the forged line the panel refused");
  });

  /* The one applicant value that reaches the prose and NEVER the column of facts, so `renderText`'s
     own fold can never cover it: without the builder's, it forges the line the panel would refuse. */
  it("folds a named opponent, which stands in the prose alone", () => {
    const zusage = buildBewerbungZusageEmail({ ...ZUSAGE, wunschgegner: NAME_MIT_UMBRUCH });

    assert.ok(!forgedLine(zusage.text), "a named opponent forged a fact line");
    assert.ok(zusage.text.includes(`Echte Schule ${GEFAELSCHT} notiert`), "the named opponent was not carried onto one line");
  });

  /* A field the builders do NOT fold on their way in, so this is what pins the guard in `zeile`
     itself rather than the fold the two decisions apply to the name. */
  it("folds any other fact's value too, not just the name", () => {
    const zusage = buildBewerbungZusageEmail({ ...ZUSAGE, rollenText: `Trainer\n${GEFAELSCHT}` });

    assert.ok(!forgedLine(zusage.text), "a seat carrying a break forged a fact line");
    assert.ok(zusage.text.includes(`Eingetragen als: Trainer ${GEFAELSCHT}`), "the seat was not carried onto one line");
  });

  /* The receipt states no name, so the seat is its only value — and it is composed by the same
     renderer, which is what makes this worth asking of all three messages rather than two. */
  it("folds a value in the receipt as well", () => {
    const eingang = buildBewerbungEingangEmail({ ...EINGANG, rollenText: `Ansprechperson\n${GEFAELSCHT}` });

    assert.ok(!forgedLine(eingang.text), "the receipt let a seat forge a fact line");
  });

  /* The stated reason is the one value that MAY hold breaks — it is a paragraph, and the panel gives
     it the full width. It keeps them, and gives up column 0 instead. */
  it("indents the stated reason's own lines rather than folding them away", () => {
    const absage = buildBewerbungAbsageEmail({ ...ABSAGE, grund: `Die Saison ist voll.\n${GEFAELSCHT}\nDritte Zeile` });

    assert.ok(!forgedLine(absage.text), "the stated reason forged a fact line");
    assert.ok(absage.text.includes(`  ${GEFAELSCHT}`), "the reason's second line lost its indent");
    assert.ok(absage.text.includes("  Dritte Zeile"), "the reason's third line was dropped");
  });

  /* Both spellings a browser submits, and the lone carriage return no form sends but a stored value
     can still hold. */
  for (const [name, umbruch] of [
    ["a line feed", "\n"],
    ["a carriage return and line feed", "\r\n"],
    ["a lone carriage return", "\r"],
  ]) {
    it(`folds ${name}`, () => {
      const zusage = buildBewerbungZusageEmail({ ...ZUSAGE, teamName: `Echte Schule${umbruch}${GEFAELSCHT}` });

      assert.ok(!forgedLine(zusage.text), `a name broken by ${name} forged a fact line`);
    });
  }
});
