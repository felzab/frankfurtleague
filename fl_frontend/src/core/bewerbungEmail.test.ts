import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import type {
  BewerbungAblehnungData,
  BewerbungAbsageData,
  BewerbungBestaetigungData,
  BewerbungEingangOffenData,
  BewerbungGeloeschtData,
  BewerbungVollstaendigData,
  BewerbungZusageData,
} from "./bewerbungEmail.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const {
  buildBewerbungAblehnungEmail,
  buildBewerbungAbsageEmail,
  buildBewerbungBestaetigungEmail,
  buildBewerbungEingangOffenEmail,
  buildBewerbungErinnerungEmail,
  buildBewerbungGeloeschtEmail,
  buildBewerbungVollstaendigEmail,
  buildBewerbungZusageEmail,
} = await import("./bewerbungEmail.ts");
const { KONTAKT_EMAIL, SITE_URL, VEREIN_ANSCHRIFT, VEREIN_NAME } = await import("./brand.ts");

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
 * The panel read back as the label-and-value pairs a reader sees, in order. Rows are matched without
 * nesting, so the wrapper cell that carries the panel's own spacing is stepped over rather than
 * swallowed.
 */
function faktListe(html: string): [string, string][] {
  // Stripped so the keys stay the nouns the text branch prints; a missing colon is its own assertion.
  const label = (cell: string | undefined): string => (cell ?? "").replace(/:$/, "");

  const rows = [...faktenBereich(html).matchAll(/<tr>((?:(?!<tr[ >])[\s\S])*?)<\/tr>/g)].map((row) =>
    [...(row[1] ?? "").matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => readable(cell[1] ?? "")),
  );

  const fakten: [string, string][] = [];
  let offen: string | null = null;
  for (const cells of rows) {
    // Two cells are a row of the label column and the value column; a single one is half of the
    // full-width pair a long value gets, so it is held until its other half arrives.
    if (cells.length === 2) fakten.push([label(cells[0]), cells[1] ?? ""]);
    else if (cells.length === 1 && offen === null) offen = label(cells[0]);
    else if (cells.length === 1) {
      fakten.push([offen ?? "", cells[0] ?? ""]);
      offen = null;
    }
  }

  return fakten;
}

/** The same pairs keyed by label. A link message states „Eingetragen als“ once per seat, so those rows are read off the list. */
function faktRows(html: string): Map<string, string> {
  return new Map(faktListe(html));
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

/** The second control both decisions carry: one page that is a dead end for neither of their readers. */
const LIGA_AKTION = { label: "Laufende Saison", href: `${SITE_URL}/dashboard` };

/** Spelled out for the reason above. The sign-in link states the same sentence, and the two move together. */
const FALLBACK_SENTENCE = "Falls der Button nicht funktioniert, kopiere diese Adresse in Deinen Browser:";

/** What each message states about who it reached: the two decisions reach three seats, the link messages one mailbox. */
const EMPFAENGER_SATZ = {
  kontaktpersonen: "Diese E-Mail geht an die Kontaktpersonen der Bewerbung.",
  eintrag: "Diese E-Mail geht nur an Dich.",
  postfach: "Diese E-Mail geht an dieses Postfach, weil dort mehrere Einträge hängen.",
  einreichende: "Diese E-Mail geht nur an die Person, die die Bewerbung eingereicht hat.",
};

/** The closing sentences of a message that reached all three seats, which is either decision. */
const FOOTER_SENTENCES = [EMPFAENGER_SATZ.kontaktpersonen, "Antworten an die Absenderadresse liest niemand."];

/** Spelled out here for the reason above: copy checked against its own source moves with it. */
const IGNORIER_SATZ =
  "Du weißt nichts von einer Bewerbung bei der Frankfurt-League? Dann ignoriere diese E-Mail einfach. Für Dich ist nichts zu tun.";

/** The text branch's close as a block, the delimiter included: its order is part of what it says. */
const textFooter = (empfaenger: keyof typeof EMPFAENGER_SATZ): string =>
  [
    "-- ",
    EMPFAENGER_SATZ[empfaenger],
    `Antworten an die Absenderadresse liest niemand. Schreibe uns an ${KONTAKT_EMAIL}.`,
    `Datenschutzerklärung: ${SITE_URL}/datenschutz`,
    `Impressum: ${SITE_URL}/impressum`,
    `${VEREIN_NAME}, ${VEREIN_ANSCHRIFT}`,
  ].join("\n");

/**
 * The two decisions, each beside the close it must carry and the destination its second control
 * takes. Paired here rather than per case, so no sweep below can check one message against another's.
 */
const MELDUNGEN = [
  { name: "Zusage", build: () => buildBewerbungZusageEmail(ZUSAGE), empfaenger: "kontaktpersonen", saisonId: ZUSAGE.saisonId },
  { name: "Absage", build: () => buildBewerbungAbsageEmail(ABSAGE), empfaenger: "kontaktpersonen", saisonId: ABSAGE.saisonId },
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

describe("both decisions", () => {
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

  /* One destination and one label for both, so no reader is sent somewhere their own message
     makes wrong — the decline least of all, which has nothing left to offer. */
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

  /* A line naming who ELSE read the message has to be true of the message it closes. Both decisions
     go to all three seats, so neither may close on a sentence naming a narrower circle. */
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

  it("never hand a reader the other decision's subject or heading", () => {
    const zusage = buildBewerbungZusageEmail(ZUSAGE);
    const absage = buildBewerbungAbsageEmail(ABSAGE);

    assert.notEqual(zusage.subject, absage.subject);
    assert.ok(!zusage.subject.includes("Absage") && !readable(zusage.html).includes("Absage für die Saison"));
    assert.ok(!absage.subject.includes("Zusage") && !readable(absage.html).includes("Zusage für die Saison"));
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

/** Not a token, and not shaped like one: a fixture a reader could mistake for a real credential is one somebody copies. */
const LINK_EINS = `${SITE_URL}/bestaetigung?token=beispiel-eins`;
const LINK_ZWEI = `${SITE_URL}/bestaetigung?token=beispiel-zwei`;
const FRIST = "18.09.2026";

const ERIKA = { vorname: "Erika", rolleText: "Ansprechperson", link: LINK_EINS };
const JONAS = { vorname: "Jonas", rolleText: "Trainerin oder Trainer", link: LINK_ZWEI };

const BESTAETIGUNG = {
  saisonId: "2627",
  schule: "Ernst-Reuter-Schule",
  seats: [ERIKA],
  fristText: FRIST,
} satisfies BewerbungBestaetigungData;

/** Two people on one school inbox, which is the case the singular form cannot reach. */
const BESTAETIGUNG_POSTFACH = { ...BESTAETIGUNG, seats: [ERIKA, JONAS] } satisfies BewerbungBestaetigungData;

/* The two registers, as whole words: a message half in one and half in the other tells two readers
   sharing an inbox about „den Button“ and „Deine Bestätigung“, of which each has two. */
const DU_FORMEN = /\b(Du|Dein|Deine|Deinen|Deinem|Deiner|Deines|Dir|Dich)\b/;
const EUCH_FORMEN = /\b(Euch|Euer|Eure|Euren|Eurem|Eurer|Eures)\b/;

/** The plural sentence for the button and the address it stands over: „der Button“ and „diese Adresse“ each count. */
const FALLBACK_SENTENCE_MEHRERE = "Falls die Buttons nicht funktionieren, kopiert diese Adressen in Euren Browser:";

const AUSSTEHEND = [
  { vorname: "Jonas", rolleText: "Trainerin oder Trainer" },
  { vorname: "Mira", rolleText: "Stellvertretung" },
];

const EINGANG_OFFEN = {
  saisonId: "2627",
  rollenText: "Ansprechperson",
  ausstehend: AUSSTEHEND,
  fristText: FRIST,
  link: LINK_EINS,
} satisfies BewerbungEingangOffenData;

const VOLLSTAENDIG = { saisonId: "2627", rollenText: "Ansprechperson" } satisfies BewerbungVollstaendigData;
const GELOESCHT = { saisonId: "2627", rollenText: "Ansprechperson", ausstehend: AUSSTEHEND } satisfies BewerbungGeloeschtData;
const ABLEHNUNG = {
  saisonId: "2627",
  rollenText: "Ansprechperson",
  abgelehnt: { vorname: "Jonas", rolleText: "Trainerin oder Trainer" },
  fristText: FRIST,
} satisfies BewerbungAblehnungData;

/** „Jonas und Mira“ as both branches print a seat list, so an order change fails rather than reading oddly. */
const OFFEN_LISTE = "Jonas (Trainerin oder Trainer) und Mira (Stellvertretung)";

/**
 * The six workflow messages, each beside the close it must carry. Paired here rather than per case,
 * so no sweep can check one message against another's.
 */
const WORKFLOW = [
  { name: "Bestätigung", build: () => buildBewerbungBestaetigungEmail(BESTAETIGUNG), empfaenger: "eintrag" },
  { name: "Bestätigung (Postfach)", build: () => buildBewerbungBestaetigungEmail(BESTAETIGUNG_POSTFACH), empfaenger: "postfach" },
  { name: "Erinnerung", build: () => buildBewerbungErinnerungEmail(BESTAETIGUNG), empfaenger: "eintrag" },
  { name: "Erinnerung (Postfach)", build: () => buildBewerbungErinnerungEmail(BESTAETIGUNG_POSTFACH), empfaenger: "postfach" },
  { name: "Eingang offen", build: () => buildBewerbungEingangOffenEmail(EINGANG_OFFEN), empfaenger: "einreichende" },
  { name: "Vollständig", build: () => buildBewerbungVollstaendigEmail(VOLLSTAENDIG), empfaenger: "einreichende" },
  { name: "Gelöscht", build: () => buildBewerbungGeloeschtEmail(GELOESCHT), empfaenger: "einreichende" },
  { name: "Ablehnung", build: () => buildBewerbungAblehnungEmail(ABLEHNUNG), empfaenger: "einreichende" },
] as const;

const alleWorkflow = () => WORKFLOW.map((meldung) => ({ ...meldung, mail: meldung.build(), footer: textFooter(meldung.empfaenger) }));

/** The controls as a reader meets them: where each goes, under the name it goes there under. */
function steuerung(html: string): { href: string; label: string }[] {
  return [...steuerBereich(html).matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((treffer) => ({
    href: treffer[1] ?? "",
    label: readable(treffer[2] ?? ""),
  }));
}

describe("buildBewerbungBestaetigungEmail", () => {
  it("states the school, the season, the reader's seat and the link's own deadline", () => {
    const mail = buildBewerbungBestaetigungEmail(BESTAETIGUNG);

    assert.equal(mail.subject, `Bitte bestätigen: Frankfurt-League, Saison ${BESTAETIGUNG.saisonId}`);
    assert.deepEqual(faktListe(mail.html), [
      ["Schule", BESTAETIGUNG.schule],
      ["Saison", BESTAETIGUNG.saisonId],
      ["Eingetragen als", ERIKA.rolleText],
      ["Link gültig bis", FRIST],
    ]);
  });

  it("carries every sentence in both branches, the link among them", () => {
    const mail = buildBewerbungBestaetigungEmail(BESTAETIGUNG);

    for (const satz of [
      `Für die Schule ${BESTAETIGUNG.schule} wurde eine Bewerbung zur Saison ${BESTAETIGUNG.saisonId} der Frankfurt-League eingereicht.`,
      `Darin bist Du als ${ERIKA.rolleText} eingetragen.`,
      "Bitte bestätige, dass das stimmt: Erst dann führt die Liga Dich als Kontaktperson.",
      "Auf der Seite gibst Du nur Dein Geburtsdatum ein, sonst nichts: Kontaktperson kann sein, wer mindestens 16 ist.",
      "Du kannst den Eintrag bestätigen oder ablehnen.",
      `Der Link ist bis zum ${FRIST} gültig und funktioniert nur einmal.`,
      "Ohne Deine Bestätigung bleibt die Bewerbung unvollständig.",
      "Nach drei Tagen erinnern wir Dich einmal; ist die Bewerbung nach 14 Tagen noch unvollständig, löschen wir sie mit allen Angaben.",
      LINK_EINS,
    ]) {
      assert.ok(flat(readable(mail.html)).includes(satz), `the HTML branch lost „${satz}“`);
      assert.ok(flat(mail.text).includes(satz), `the text branch lost „${satz}“`);
    }
  });

  /* One reader, one press, one deadline. Each branch names the control it can actually draw, which
     is why the button and the link are asserted per branch rather than across both. */
  it("speaks of one button, one link and one deadline, and takes no plural form", () => {
    const mail = buildBewerbungBestaetigungEmail(BESTAETIGUNG);

    assert.ok(flat(readable(mail.html)).includes("Klicke auf den Button."), "the markup branch does not name the one button");
    assert.ok(flat(mail.text).includes("Öffne diesen Link."), "the text branch does not name the one link");
    assert.ok(flat(readable(mail.html)).includes(FALLBACK_SENTENCE), "the markup branch offers the address with no sentence in the singular");
    assert.equal(faktRows(mail.html).get("Link gültig bis"), FRIST);
    for (const zweig of [flat(readable(mail.html)), flat(mail.text)]) {
      assert.doesNotMatch(zweig, EUCH_FORMEN, "one reader is addressed as several");
      assert.ok(!zweig.includes("Links gültig bis"), "one link is dated as several");
    }
  });

  /* One press is what this message exists for. A second destination beside it competes with the one
     the reader came for, which is the sign-in link's reason. */
  it("offers one control, and it is the link", () => {
    assert.deepEqual(steuerung(buildBewerbungBestaetigungEmail(BESTAETIGUNG).html), [{ href: LINK_EINS, label: "Eintrag bestätigen" }]);
  });

  it("gives a mailbox holding two seats one link each, under the name and role of the person it answers for", () => {
    const mail = buildBewerbungBestaetigungEmail(BESTAETIGUNG_POSTFACH);

    assert.deepEqual(steuerung(mail.html), [
      { href: LINK_EINS, label: `Eintrag bestätigen: ${ERIKA.vorname} (${ERIKA.rolleText})` },
      { href: LINK_ZWEI, label: `Eintrag bestätigen: ${JONAS.vorname} (${JONAS.rolleText})` },
    ]);
    // The panel names whose each row is, which the singular form has nobody to distinguish.
    assert.deepEqual(faktListe(mail.html), [
      ["Schule", BESTAETIGUNG.schule],
      ["Saison", BESTAETIGUNG.saisonId],
      ["Eingetragen als", `${ERIKA.vorname} (${ERIKA.rolleText})`],
      ["Eingetragen als", `${JONAS.vorname} (${JONAS.rolleText})`],
      ["Links gültig bis", FRIST],
    ]);
    // Both addresses reach the branch with no buttons too, each still placed by name.
    for (const [seat, url] of [
      [ERIKA, LINK_EINS],
      [JONAS, LINK_ZWEI],
    ] as const) {
      assert.ok(mail.text.includes(`${seat.vorname} (${seat.rolleText}):\n${url}`), `the text branch does not place ${seat.vorname}'s link`);
    }
  });

  /* Every sentence, not the opening ones alone: a message that greets „Eure Einträge“ and then
     speaks of THE button and DEINE Bestätigung tells two readers they share one press. */
  it("addresses a shared mailbox in the plural, in every sentence it states", () => {
    const mail = buildBewerbungBestaetigungEmail(BESTAETIGUNG_POSTFACH);
    const beide = `${ERIKA.vorname} (${ERIKA.rolleText}) und ${JONAS.vorname} (${JONAS.rolleText})`;

    for (const satz of [
      `Eure Einträge für die Saison ${BESTAETIGUNG.saisonId}`,
      `Mit dieser E-Mail-Adresse sind darin ${beide} eingetragen.`,
      "Bitte bestätigt jeden Eintrag einzeln: Erst dann führt die Liga Euch als Kontaktpersonen.",
      "Kontaktperson kann sein, wer mindestens 16 ist. Jeder Eintrag lässt sich bestätigen oder ablehnen.",
      `Jeder Link ist bis zum ${FRIST} gültig und funktioniert nur einmal.`,
      "Ohne Eure Bestätigungen bleibt die Bewerbung unvollständig. Nach drei Tagen erinnern wir Euch einmal;",
      "Für Euch ist nichts zu tun: Eure Angaben werden nach 14 Tagen gelöscht. Oder lehnt über die Links ab",
      EMPFAENGER_SATZ.postfach,
    ]) {
      assert.ok(flat(readable(mail.html)).includes(satz), `the HTML branch lost „${satz}“`);
      assert.ok(flat(mail.text).includes(satz), `the text branch lost „${satz}“`);
    }
    // Each branch names the control it can draw, and the panel dates the links it carries.
    assert.ok(flat(readable(mail.html)).includes("Klickt auf die Buttons und gebt dort nur Euer Geburtsdatum ein"), "one button for two");
    assert.ok(flat(mail.text).includes("Öffnet diese Links und gebt dort nur Euer Geburtsdatum ein"), "one link for two");
    assert.ok(flat(readable(mail.html)).includes(FALLBACK_SENTENCE_MEHRERE), "two addresses stand under a sentence offering one");
    assert.equal(faktRows(mail.html).get("Links gültig bis"), FRIST);
    // Nothing left of the reader who was written to alone: not a pronoun, not a noun, not a verb.
    for (const zweig of [flat(readable(mail.html)), flat(mail.text)]) {
      assert.doesNotMatch(zweig, DU_FORMEN, "a shared mailbox is addressed as one person");
      assert.ok(!zweig.includes(FALLBACK_SENTENCE), "the singular fallback sentence stands over two addresses");
      assert.ok(!zweig.includes("Link gültig bis"), "two links are dated as one");
    }
  });

  /* `trainer_ist_zugleich` is one person under one token, which reaches this builder as a single
     seat naming both roles. Two buttons to one URL would read as two things to do. */
  it("names both seats and offers one control where one link answers for two", () => {
    const zugleich = { vorname: "Erika", rolleText: "Ansprechperson und Trainerin oder Trainer", link: LINK_EINS };
    const mail = buildBewerbungBestaetigungEmail({ ...BESTAETIGUNG, seats: [zugleich] });

    assert.deepEqual(steuerung(mail.html), [{ href: LINK_EINS, label: "Eintrag bestätigen" }]);
    assert.equal(faktRows(mail.html).get("Eingetragen als"), zugleich.rolleText);
    assert.ok(flat(mail.text).includes(`Darin bist Du als ${zugleich.rolleText} eingetragen.`));
  });
});

describe("buildBewerbungErinnerungEmail", () => {
  it("names the deletion date rather than the link's validity, and carries the first message's link", () => {
    const mail = buildBewerbungErinnerungEmail(BESTAETIGUNG);

    assert.equal(mail.subject, `Erinnerung: Frankfurt-League, Saison ${BESTAETIGUNG.saisonId}`);
    assert.deepEqual(faktListe(mail.html), [
      ["Schule", BESTAETIGUNG.schule],
      ["Saison", BESTAETIGUNG.saisonId],
      ["Eingetragen als", ERIKA.rolleText],
      ["Bewerbung wird gelöscht am", FRIST],
    ]);
    assert.deepEqual(steuerung(mail.html), [{ href: LINK_EINS, label: "Eintrag bestätigen" }]);
  });

  it("carries every sentence in both branches", () => {
    const mail = buildBewerbungErinnerungEmail(BESTAETIGUNG);

    for (const satz of [
      "Vor drei Tagen haben wir Dich gebeten, Deinen Eintrag zu bestätigen:",
      `In der Bewerbung der Schule ${BESTAETIGUNG.schule} zur Saison ${BESTAETIGUNG.saisonId} bist Du als ${ERIKA.rolleText} eingetragen.`,
      "Bis jetzt fehlt Deine Antwort.",
      `Ohne Deine Antwort löschen wir die Bewerbung am ${FRIST} mit allen Angaben.`,
      LINK_EINS,
    ]) {
      assert.ok(flat(readable(mail.html)).includes(satz), `the HTML branch lost „${satz}“`);
      assert.ok(flat(mail.text).includes(satz), `the text branch lost „${satz}“`);
    }
    assert.ok(flat(readable(mail.html)).includes("Klicke auf den Button, gib Dein Geburtsdatum ein"), "the markup branch lost its one button");
    assert.ok(flat(mail.text).includes("Öffne diesen Link, gib Dein Geburtsdatum ein"), "the text branch lost its one link");
    assert.ok(flat(readable(mail.html)).includes(FALLBACK_SENTENCE), "the address stands under no sentence in the singular");
    for (const zweig of [flat(readable(mail.html)), flat(mail.text)]) {
      assert.doesNotMatch(zweig, EUCH_FORMEN, "one reader is chased as several");
    }
  });

  /* A seat that has answered carries no link, so the mailbox it shares is reminded about the other
     one alone -- nobody is chased on somebody else's account. */
  it("carries a link only for the seats it was given one for", () => {
    const mail = buildBewerbungErinnerungEmail({ ...BESTAETIGUNG, seats: [JONAS] });

    assert.deepEqual(steuerung(mail.html), [{ href: LINK_ZWEI, label: "Eintrag bestätigen" }]);
    for (const branch of [readable(mail.html), mail.text]) {
      assert.ok(!branch.includes(LINK_EINS), "a seat with no link was reminded anyway");
      assert.ok(branch.includes(JONAS.rolleText));
    }
  });

  it("addresses a shared mailbox in the plural, in every sentence it states", () => {
    const mail = buildBewerbungErinnerungEmail(BESTAETIGUNG_POSTFACH);
    const beide = `${ERIKA.vorname} (${ERIKA.rolleText}) und ${JONAS.vorname} (${JONAS.rolleText})`;

    for (const satz of [
      `Erinnerung: Eure Einträge für die Saison ${BESTAETIGUNG.saisonId}`,
      "Vor drei Tagen haben wir Euch gebeten, Eure Einträge zu bestätigen:",
      `sind mit dieser E-Mail-Adresse ${beide} eingetragen.`,
      "Bis jetzt fehlt Eure Antwort.",
      `Ohne Eure Antwort löschen wir die Bewerbung am ${FRIST} mit allen Angaben.`,
      "Für Euch ist nichts zu tun: Eure Angaben werden nach 14 Tagen gelöscht. Oder lehnt über die Links ab",
    ]) {
      assert.ok(flat(readable(mail.html)).includes(satz), `the HTML branch lost „${satz}“`);
      assert.ok(flat(mail.text).includes(satz), `the text branch lost „${satz}“`);
    }
    assert.ok(flat(readable(mail.html)).includes("Klickt auf die Buttons, gebt Euer Geburtsdatum ein und bestätigt die Einträge"));
    assert.ok(flat(mail.text).includes("Öffnet diese Links, gebt Euer Geburtsdatum ein und bestätigt die Einträge"));
    assert.ok(flat(readable(mail.html)).includes(FALLBACK_SENTENCE_MEHRERE), "two addresses stand under a sentence offering one");
    for (const zweig of [flat(readable(mail.html)), flat(mail.text)]) {
      assert.doesNotMatch(zweig, DU_FORMEN, "a shared mailbox is chased as one person");
      assert.ok(!zweig.includes(FALLBACK_SENTENCE), "the singular fallback sentence stands over two addresses");
    }
  });
});

describe("buildBewerbungEingangOffenEmail", () => {
  it("names who is still open and the reader's own link, and no school", () => {
    const mail = buildBewerbungEingangOffenEmail(EINGANG_OFFEN);

    assert.equal(mail.subject, `Bewerbung eingegangen: Frankfurt-League, Saison ${EINGANG_OFFEN.saisonId}`);
    assert.deepEqual(faktListe(mail.html), [
      ["Status", "Eingegangen, Bestätigungen offen"],
      ["Saison", EINGANG_OFFEN.saisonId],
      ["Eingetragen als", EINGANG_OFFEN.rollenText],
      ["Noch offen", OFFEN_LISTE],
      ["Frist", FRIST],
    ]);
    /* A mistyped submitter address then hands a stranger two first names and two roles with nothing
       to attach them to, which is why no message to the submitter names the school. */
    for (const branch of [readable(mail.html), mail.text]) {
      assert.ok(!branch.includes(BESTAETIGUNG.schule), "a message to the submitter names the school");
    }
  });

  it("carries every sentence in both branches", () => {
    const mail = buildBewerbungEingangOffenEmail(EINGANG_OFFEN);

    for (const satz of [
      `Deine Bewerbung für die Saison ${EINGANG_OFFEN.saisonId} der Frankfurt-League ist bei uns eingegangen.`,
      "Vollständig ist sie, sobald jede Kontaktperson ihren Eintrag selbst bestätigt hat.",
      "Nach drei Tagen erinnern wir alle, die noch nicht bestätigt haben.",
      `Ist die Bewerbung am ${FRIST} noch unvollständig, löschen wir sie mit allen Angaben und sagen Dir Bescheid.`,
      "Sag den anderen am besten selbst Bescheid, dann geht es schneller.",
      OFFEN_LISTE,
      LINK_EINS,
    ]) {
      assert.ok(flat(readable(mail.html)).includes(satz), `the HTML branch lost „${satz}“`);
      assert.ok(flat(mail.text).includes(satz), `the text branch lost „${satz}“`);
    }
  });

  it("offers the reader's own link first and the way to a person beside it", () => {
    assert.deepEqual(steuerung(buildBewerbungEingangOffenEmail(EINGANG_OFFEN).html), [
      { href: LINK_EINS, label: "Meinen Eintrag bestätigen" },
      { href: `mailto:${KONTAKT_EMAIL}`, label: "Frage stellen" },
    ]);
  });

  /* This is the message that arrives while nothing has been decided, so a reader who met either
     decision's wording in it would read a decision the league has not taken. */
  it("carries no word of a decision, and no copy of what was submitted", () => {
    const mail = buildBewerbungEingangOffenEmail(EINGANG_OFFEN);

    for (const wort of ["Zusage", "Absage", "aufgenommen", "können wir das Team nicht aufnehmen"]) {
      assert.ok(!mail.subject.includes(wort), `the receipt's subject says „${wort}“`);
      assert.ok(!readable(mail.html).includes(wort), `the receipt says „${wort}“`);
      assert.ok(!mail.text.includes(wort), `the receipt's text branch says „${wort}“`);
    }
    /* It goes out before anybody has confirmed the address, so of the form it repeats the seats
       still open and nothing else — no club, no wish, and no contact detail anybody typed. */
    for (const eingetragen of [ZUSAGE.teamName, ZUSAGE.wunschgegner, "erika@beispiel.de", "069 1234567", "Goethe-Gymnasium"]) {
      assert.ok(!readable(mail.html).includes(eingetragen), `the receipt repeats „${eingetragen}“`);
      assert.ok(!mail.text.includes(eingetragen), `the receipt's text branch repeats „${eingetragen}“`);
    }
  });
});

describe("buildBewerbungVollstaendigEmail", () => {
  it("states that every contact confirmed, and offers the pair the decisions offer", () => {
    const mail = buildBewerbungVollstaendigEmail(VOLLSTAENDIG);

    assert.equal(mail.subject, `Bewerbung vollständig: Frankfurt-League, Saison ${VOLLSTAENDIG.saisonId}`);
    assert.deepEqual(faktListe(mail.html), [
      ["Status", "Vollständig, in Prüfung"],
      ["Saison", VOLLSTAENDIG.saisonId],
      ["Eingetragen als", VOLLSTAENDIG.rollenText],
    ]);
    assert.deepEqual(steuerung(mail.html), [
      { href: `mailto:${KONTAKT_EMAIL}`, label: "Frage stellen" },
      { href: LIGA_AKTION.href, label: LIGA_AKTION.label },
    ]);
  });

  it("carries every sentence in both branches", () => {
    const mail = buildBewerbungVollstaendigEmail(VOLLSTAENDIG);

    for (const satz of [
      `Vollständig: Bewerbung für die Saison ${VOLLSTAENDIG.saisonId}`,
      "Alle Kontaktpersonen haben ihren Eintrag bestätigt.",
      `Deine Bewerbung für die Saison ${VOLLSTAENDIG.saisonId} der Frankfurt-League ist damit vollständig, und wir schauen sie uns an.`,
      "Wir melden uns bei allen drei Kontaktpersonen, sobald wir entschieden haben.",
      "Du musst nichts weiter tun.",
      WEBSITE_SENTENCE,
    ]) {
      assert.ok(flat(readable(mail.html)).includes(satz), `the HTML branch lost „${satz}“`);
      assert.ok(flat(mail.text).includes(satz), `the text branch lost „${satz}“`);
    }
  });
});

describe("buildBewerbungGeloeschtEmail", () => {
  it("names who did not confirm and offers the way to start again", () => {
    const mail = buildBewerbungGeloeschtEmail(GELOESCHT);

    assert.equal(mail.subject, `Bewerbung gelöscht: Frankfurt-League, Saison ${GELOESCHT.saisonId}`);
    assert.deepEqual(faktListe(mail.html), [
      ["Status", "Gelöscht, nicht vollständig geworden"],
      ["Saison", GELOESCHT.saisonId],
      ["Eingetragen als", GELOESCHT.rollenText],
      // Named, because a school told only that the application lapsed collects the same people again.
      ["Nicht bestätigt", OFFEN_LISTE],
    ]);
    assert.deepEqual(steuerung(mail.html), [
      { href: `${SITE_URL}/bewerbung/${GELOESCHT.saisonId}`, label: "Neu bewerben" },
      { href: `mailto:${KONTAKT_EMAIL}`, label: "Frage stellen" },
    ]);
  });

  it("carries every sentence in both branches", () => {
    const mail = buildBewerbungGeloeschtEmail(GELOESCHT);

    for (const satz of [
      `Gelöscht: Bewerbung für die Saison ${GELOESCHT.saisonId}`,
      "14 Tage lang haben nicht alle Kontaktpersonen ihren Eintrag bestätigt.",
      `Deshalb haben wir Deine Bewerbung für die Saison ${GELOESCHT.saisonId} mit allen Angaben gelöscht, wie angekündigt.`,
      "Solange die Bewerbungsfrist läuft, kann sich Deine Schule neu bewerben.",
      "Frag die Kontaktpersonen am besten vorher, dann klappt es beim zweiten Mal schneller.",
      OFFEN_LISTE,
    ]) {
      assert.ok(flat(readable(mail.html)).includes(satz), `the HTML branch lost „${satz}“`);
      assert.ok(flat(mail.text).includes(satz), `the text branch lost „${satz}“`);
    }
    // The text branch has no button to draw, so the offer is a labelled line under the note.
    assert.ok(mail.text.includes(`Neu bewerben: ${SITE_URL}/bewerbung/${GELOESCHT.saisonId}`), "the text branch offers no way to start again");
  });
});

describe("buildBewerbungAblehnungEmail", () => {
  it("names the person and the role and takes no pronoun for either", () => {
    const mail = buildBewerbungAblehnungEmail(ABLEHNUNG);
    const wer = `${ABLEHNUNG.abgelehnt.vorname} (${ABLEHNUNG.abgelehnt.rolleText})`;

    assert.equal(mail.subject, `Eintrag abgelehnt: Frankfurt-League, Saison ${ABLEHNUNG.saisonId}`);
    assert.deepEqual(faktListe(mail.html), [
      ["Status", "Nicht vollständig, eine Bestätigung fehlt"],
      ["Saison", ABLEHNUNG.saisonId],
      ["Eingetragen als", ABLEHNUNG.rollenText],
      ["Abgelehnt von", wer],
    ]);
    for (const satz of [
      `${wer} hat den Eintrag als Kontaktperson abgelehnt.`,
      // „Diese Angaben“ stands where „seine“ or „ihre“ would, so the sentence reads for every name.
      "Diese Angaben haben wir aus der Bewerbung entfernt.",
      `So kann die Bewerbung nicht vollständig werden; am ${FRIST} löschen wir sie.`,
      "Möchte Deine Schule trotzdem mitspielen, bewirb Dich neu, mit einer anderen Person in dieser Rolle. Frag sie vorher.",
    ]) {
      assert.ok(flat(readable(mail.html)).includes(satz), `the HTML branch lost „${satz}“`);
      assert.ok(flat(mail.text).includes(satz), `the text branch lost „${satz}“`);
    }
    for (const pronomen of ["seine Angaben", "ihre Angaben", "seinen Eintrag", "ihren Eintrag"]) {
      assert.ok(!flat(readable(mail.html)).includes(pronomen), `the message takes „${pronomen}“, which misreads for half the names`);
    }
  });

  it("offers the way to start again, as the deletion notice does", () => {
    assert.deepEqual(steuerung(buildBewerbungAblehnungEmail(ABLEHNUNG).html), [
      { href: `${SITE_URL}/bewerbung/${ABLEHNUNG.saisonId}`, label: "Neu bewerben" },
      { href: `mailto:${KONTAKT_EMAIL}`, label: "Frage stellen" },
    ]);
  });
});

describe("the confirmation workflow's messages", () => {
  it("state the same facts in both branches", () => {
    for (const { name, mail } of alleWorkflow()) {
      const fakten = faktListe(mail.html);

      assert.ok(fakten.length >= 3, `${name} states no panel of facts at all, so this test proves nothing`);
      for (const [label, value] of fakten) {
        assert.ok(flat(mail.text).includes(`${label}: ${value}`), `${name}'s text branch lost „${label}: ${value}“`);
      }
    }
  });

  it("close on the recipient sentence each of them is actually true of", () => {
    for (const { name, mail, empfaenger, footer } of alleWorkflow()) {
      assert.ok(flat(readable(mail.html)).includes(EMPFAENGER_SATZ[empfaenger]), `${name}'s markup branch does not say who it reached`);
      assert.ok(mail.text.endsWith(`\n${footer}`), `${name}'s text branch does not close with its footer, in its order`);

      for (const [kreis, satz] of Object.entries(EMPFAENGER_SATZ)) {
        if (kreis === empfaenger) continue;
        assert.ok(!flat(readable(mail.html)).includes(satz), `${name} tells its reader it reached the ${kreis}`);
      }
    }
  });

  /* What ignoring costs differs per message: a contact can end their seat through the link, the
     submitter can only wait, and after the deletion there is nothing left to promise. */
  it("tell a reader who never applied what ignoring the message actually costs", () => {
    const auftakt =
      "Du weißt nichts von einer Bewerbung bei der Frankfurt-League? Dann ignoriere diese E-Mail einfach. Für Dich ist nichts zu tun";
    const auftaktMehrere =
      "Weiß hier niemand von einer Bewerbung bei der Frankfurt-League? Dann ignoriert diese E-Mail einfach. Für Euch ist nichts zu tun";
    const eintrag = `${auftakt}: Deine Angaben werden nach 14 Tagen gelöscht. Oder lehne über den Link ab, dann entfernen wir sie sofort.`;
    const eintragMehrere = `${auftaktMehrere}: Eure Angaben werden nach 14 Tagen gelöscht. Oder lehnt über die Links ab, dann entfernen wir sie sofort.`;
    const NOTIZ: Record<string, string> = {
      Bestätigung: eintrag,
      "Bestätigung (Postfach)": eintragMehrere,
      Erinnerung: eintrag,
      "Erinnerung (Postfach)": eintragMehrere,
      "Eingang offen": `${auftakt}: die Bewerbung wird nach 14 Tagen gelöscht.`,
      Vollständig: `${auftakt}.`,
      Gelöscht: `${auftakt}: die Bewerbung wurde gelöscht.`,
      Ablehnung: `${auftakt}: die Bewerbung wird nach 14 Tagen gelöscht.`,
    };

    for (const { name, mail } of alleWorkflow()) {
      const satz = NOTIZ[name] ?? "";

      assert.notEqual(satz, "", `${name} has no note of its own listed here, so this case proves nothing`);
      assert.ok(flat(readable(mail.html)).includes(satz), `${name}'s markup branch does not say what ignoring costs`);
      assert.ok(flat(mail.text).includes(satz), `${name}'s text branch does not say what ignoring costs`);
      // Once: `renderHtml` carries it for every message, and one adding its own would say it twice.
      assert.equal(mail.text.split(satz.slice(0, 40)).length - 1, 1, `${name}'s text branch states the note twice`);
    }
  });

  it("set every „Saison NNNN“ in the brand colour", () => {
    let gefunden = 0;

    for (const { name, mail } of alleWorkflow()) {
      const koerper = mail.html.slice(mail.html.indexOf("</head>"));
      const stellen = [...koerper.matchAll(/Saison 2627/g)].map((treffer) => treffer.index);

      // The decline states it in its heading alone; every other message states it in its prose too.
      assert.ok(stellen.length >= 1, `${name} does not name its season in its body at all`);
      gefunden += stellen.length;
      for (const stelle of stellen) {
        assert.ok(
          koerper.slice(0, stelle).endsWith(`<strong class="fl-brand" style="color:${BRAND_COLOR};">`),
          `${name} states the season uncoloured`,
        );
      }
    }

    assert.ok(gefunden > WORKFLOW.length, "the phrase stands once per message at most, so this test proves nothing");
  });

  /* `docs/frontend/spec.md :: 1.12`: the reader is `Du`, capitalised everywhere; no dash is
     punctuation; and a club is a `Team`. A lower-case address reads as a different register. */
  it("keep the copy rules the whole product is written to", () => {
    for (const { name, mail } of alleWorkflow()) {
      // The signature delimiter is RFC 3676's line and not punctuation, so it is read past.
      const zweige = [
        readable(mail.html),
        mail.text
          .split("\n")
          .filter((zeile) => zeile !== "-- ")
          .join("\n"),
      ];

      for (const zweig of zweige) {
        assert.doesNotMatch(
          zweig,
          /\b(du|dein|deine|deinen|deinem|deiner|deines|dir|dich|euch|euer|eure|euren|eurem|eurer)\b/,
          `${name} addresses its reader in lower case`,
        );
        assert.doesNotMatch(zweig, /\s[—–-]\s/, `${name} uses a dash as punctuation`);
        assert.ok(!zweig.includes("Mannschaft"), `${name} says „Mannschaft“ where the league says „Team“`);
        assert.ok(!zweig.includes("bereits"), `${name} says „bereits“ where the league says „schon“`);
      }
    }
  });

  /* Every value these builders interpolate, one hostile fixture at a time -- the nested seat fields
     included, which no sweep over a flat record would reach. */
  it("escape every value they interpolate into the markup", () => {
    const gift = HOSTILE_NAME;
    const cases = [
      { field: "Bestätigung.schule", mail: buildBewerbungBestaetigungEmail({ ...BESTAETIGUNG, schule: gift }) },
      { field: "Bestätigung.fristText", mail: buildBewerbungBestaetigungEmail({ ...BESTAETIGUNG, fristText: gift }) },
      {
        field: "Bestätigung.seats.rolleText",
        mail: buildBewerbungBestaetigungEmail({ ...BESTAETIGUNG, seats: [{ ...ERIKA, rolleText: gift }] }),
      },
      {
        field: "Bestätigung.seats.vorname",
        mail: buildBewerbungBestaetigungEmail({ ...BESTAETIGUNG, seats: [{ ...ERIKA, vorname: gift }, JONAS] }),
      },
      { field: "Erinnerung.schule", mail: buildBewerbungErinnerungEmail({ ...BESTAETIGUNG, schule: gift }) },
      { field: "Erinnerung.seats.rolleText", mail: buildBewerbungErinnerungEmail({ ...BESTAETIGUNG, seats: [{ ...ERIKA, rolleText: gift }] }) },
      { field: "Eingang offen.rollenText", mail: buildBewerbungEingangOffenEmail({ ...EINGANG_OFFEN, rollenText: gift }) },
      {
        field: "Eingang offen.ausstehend.vorname",
        mail: buildBewerbungEingangOffenEmail({ ...EINGANG_OFFEN, ausstehend: [{ vorname: gift, rolleText: "Stellvertretung" }] }),
      },
      { field: "Vollständig.rollenText", mail: buildBewerbungVollstaendigEmail({ ...VOLLSTAENDIG, rollenText: gift }) },
      {
        field: "Gelöscht.ausstehend.rolleText",
        mail: buildBewerbungGeloeschtEmail({ ...GELOESCHT, ausstehend: [{ vorname: "Mira", rolleText: gift }] }),
      },
      {
        field: "Ablehnung.abgelehnt.vorname",
        mail: buildBewerbungAblehnungEmail({ ...ABLEHNUNG, abgelehnt: { vorname: gift, rolleText: "Stellvertretung" } }),
      },
      { field: "Ablehnung.fristText", mail: buildBewerbungAblehnungEmail({ ...ABLEHNUNG, fristText: gift }) },
    ];

    for (const { field, mail } of cases) {
      assert.ok(!mail.html.includes("<script>"), `${field} reaches the markup unescaped`);
      // Decoding the markup back returns the value, so escaping changed the encoding and not the fact.
      assert.ok(readable(mail.html).includes(gift), `${field} did not survive escaping as the value written`);
      assert.equal(stylesheet(mail.html), stylesheet(buildBewerbungVollstaendigEmail(VOLLSTAENDIG).html), `${field} reached the stylesheet`);
    }
  });

  /* A client folding at a value's own delimiter line hides every line below it, the whole close
     included. Stuffing is what keeps the value AND the footer. */
  it("keep every value they interpolate from opening a second signature block", () => {
    const cases = [
      {
        field: "Bestätigung.schule",
        mail: buildBewerbungBestaetigungEmail({ ...BESTAETIGUNG, schule: DELIMITER_VALUE }),
        empfaenger: "eintrag",
      },
      {
        field: "Erinnerung.seats.vorname",
        mail: buildBewerbungErinnerungEmail({ ...BESTAETIGUNG, seats: [{ ...ERIKA, vorname: DELIMITER_VALUE }, JONAS] }),
        empfaenger: "postfach",
      },
      {
        field: "Eingang offen.ausstehend.vorname",
        mail: buildBewerbungEingangOffenEmail({ ...EINGANG_OFFEN, ausstehend: [{ vorname: DELIMITER_VALUE, rolleText: "Stellvertretung" }] }),
        empfaenger: "einreichende",
      },
      {
        field: "Ablehnung.abgelehnt.vorname",
        mail: buildBewerbungAblehnungEmail({ ...ABLEHNUNG, abgelehnt: { vorname: DELIMITER_VALUE, rolleText: "Stellvertretung" } }),
        empfaenger: "einreichende",
      },
    ] as const;

    for (const { field, mail, empfaenger } of cases) {
      assert.equal([...mail.text.matchAll(/^-- $/gm)].length, 1, `${field} stands as a second signature delimiter`);
      assert.ok(mail.text.includes("Erste Zeile") && mail.text.includes("Zweite Zeile"), `${field}'s value was dropped rather than carried`);
      assert.ok(mail.text.endsWith(`\n${textFooter(empfaenger)}`), `${field} pushed the footer out of the close`);
      assert.ok(readable(mail.html).includes("Zweite Zeile"), `${field} lost the line below its delimiter in the markup`);
    }
  });

  /* An address a reader has to select and paste is not a route, and one marked by colour alone is
     not a link to a reader who cannot see the colour. */
  it("make every address standing in prose a marked link", () => {
    for (const { name, mail } of alleWorkflow()) {
      for (const absatz of mail.html.matchAll(/<p [^>]*>([\s\S]*?)<\/p>/g)) {
        const inner = absatz[1] ?? "";
        if (!inner.includes(SITE_URL) && !inner.includes(KONTAKT_EMAIL)) continue;

        assert.match(inner, /<a href="[^"]+"[^>]*>[^<]+<\/a>/, `${name} sets an address in prose without a link`);
        assert.ok(inner.includes("text-decoration:underline"), `${name}'s prose link is marked by colour alone`);
      }
    }
  });

  /* A token URL is longer than the card is wide. Without the break it pushes the card open, and the
     reader it exists for -- the one whose client drew no button -- is the one it breaks for. */
  it("break a link that stands in the prose inside the word", () => {
    for (const { name, mail } of alleWorkflow()) {
      const absaetze = [...mail.html.matchAll(/<p ([^>]*)>([\s\S]*?)<\/p>/g)].filter(([, , inner]) => (inner ?? "").includes("/bestaetigung?"));
      if (absaetze.length === 0) continue;

      for (const [, stil] of absaetze) {
        assert.ok((stil ?? "").includes("word-break:break-all"), `${name} sets a token URL in a paragraph that cannot break`);
      }
      // In the register the rest of the message is written in: the sentence counts both the buttons
      // above it and the addresses below it.
      const satz = name.includes("Postfach") ? FALLBACK_SENTENCE_MEHRERE : FALLBACK_SENTENCE;
      assert.ok(flat(readable(mail.html)).includes(satz), `${name} offers an address with no sentence saying why`);
    }
  });

  /* `docs/frontend/spec.md :: I46` reaches these messages through the same renderer as the two
     decisions: a value carrying a break would open a line no reader can tell from a stated fact. */
  it("fold a value carrying a break onto one line", () => {
    const geforgt = "Startgeld: 500 Euro";
    const mail = buildBewerbungErinnerungEmail({ ...BESTAETIGUNG, schule: `Echte Schule\n${geforgt}` });

    assert.ok(!mail.text.split("\n").some((zeile) => zeile.startsWith(geforgt)), "a submitted school name forged a fact line");
    assert.ok(mail.text.includes(`Schule: Echte Schule ${geforgt}`), "the name was not carried onto one line");
  });
});
