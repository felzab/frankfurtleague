import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import type { BewerbungAbsageData, BewerbungZusageData } from "./bewerbungEmail.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { buildBewerbungAbsageEmail, buildBewerbungZusageEmail, stuffSignatureDelimiter } = await import("./bewerbungEmail.ts");
const { KONTAKT_EMAIL } = await import("./brand.ts");

/**
 * The markup branch reduced to the facts a reader ends up with. Lets a fact be checked as a fact in
 * both branches instead of as one hand-written substring per branch, which is how a pair drifts
 * apart unnoticed.
 */
function readable(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** The text branch on the same terms, so a comparison between the two is not a comparison of line wrapping. */
const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The module as text, for the two claims about its own shape that no return value carries. */
const MODULE_SOURCE = readFileSync(path.resolve(import.meta.dirname, "bewerbungEmail.ts"), "utf8");

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
  gruppe: "B",
  trikotFarbeLabel: "Hellgrün",
} satisfies BewerbungZusageData;
const ABSAGE = {
  teamName: "Ernst-Reuter-Schule",
  saisonId: "2627",
  grund: "Die Saison ist voll: 16 Teams sind bereits aufgenommen.",
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
const WEBSITE_SENTENCE = "Spielplan, Tabelle und Ergebnisse veröffentlichen wir auf https://frankfurtleague.de, sobald die Saison startet.";
const FOOTER_SENTENCES = ["Diese E-Mail geht an die Kontaktpersonen der Bewerbung.", "Antworten an die Absenderadresse liest niemand."];

/** The text branch's close as a block, the delimiter included: its order is part of what it says. */
const TEXT_FOOTER = [
  "-- ",
  "Diese E-Mail geht an die Kontaktpersonen der Bewerbung.",
  `Antworten an die Absenderadresse liest niemand. Schreibe uns an ${KONTAKT_EMAIL}.`,
].join("\n");

describe("buildBewerbungZusageEmail", () => {
  it("carries every fact in both branches", () => {
    const mail = buildBewerbungZusageEmail(ZUSAGE);

    for (const fact of [
      ZUSAGE.teamName,
      ZUSAGE.saisonId,
      `Zusage für die Saison ${ZUSAGE.saisonId}`,
      `Gruppe ${ZUSAGE.gruppe}`,
      ZUSAGE.trikotFarbeLabel,
      KONTAKT_EMAIL,
      // The sentences the values stand in, and not only the values: a heading carrying the season
      // lets the body lose the sentence that says what happened to the team.
      `${ZUSAGE.teamName} ist für die Saison ${ZUSAGE.saisonId} der Frankfurt-League aufgenommen.`,
      "Gespielt wird in Gruppe",
      "Die Trikotfarbe des Teams ist",
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

    for (const branch of [readable(mail.html), flat(mail.text)]) {
      assert.ok(branch.includes("Eine Trikotfarbe ist noch nicht festgelegt."));
      assert.ok(!branch.includes("Die Trikotfarbe des Teams ist"));
      // The group survives the colour being absent: the two facts share a paragraph in the markup branch.
      assert.ok(branch.includes(`Gruppe ${ZUSAGE.gruppe}`));
    }
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
  it("carries every fact in both branches", () => {
    const mail = buildBewerbungAbsageEmail(ABSAGE);

    for (const fact of [
      ABSAGE.teamName,
      ABSAGE.saisonId,
      `Absage für die Saison ${ABSAGE.saisonId}`,
      ABSAGE.grund,
      KONTAKT_EMAIL,
      // As in the acceptance: the sentences themselves, not only the values standing in them.
      `Danke, dass ${ABSAGE.teamName} sich für die Saison ${ABSAGE.saisonId} der Frankfurt-League beworben hat.`,
      "Angegebener Grund:",
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

    // `strong()` marks the one fact a paragraph exists to carry, and a reason runs to 1000 characters.
    // The team name is asserted too, so a message that emphasised nothing could not pass this.
    assert.ok(
      emphasised.some((inner) => inner.includes(ABSAGE.teamName)),
      "the team name lost its emphasis",
    );
    assert.ok(!emphasised.some((inner) => inner.includes(ABSAGE.grund)), "the reason is shouted");
  });

  /* The administrator writes the reason, and a line of it reading as RFC 3676's delimiter would put a
     second signature above the real one -- folding away every sentence below, the closing one first. */
  it("keeps a stated reason from opening a second signature block", () => {
    const mail = buildBewerbungAbsageEmail({ ...ABSAGE, grund: "Erster Grund\n-- \nZweiter Grund" });

    assert.equal([...mail.text.matchAll(/^-- $/gm)].length, 1, "a reason's own line stands as a second signature delimiter");
    assert.ok(mail.text.includes("\n -- \n"), "the reason's line was dropped rather than stuffed, so the reader loses it");
    assert.ok(mail.text.includes("Zweiter Grund"), "the reason lost a line");

    // A `TextArea` submits either newline, so the CRLF spelling is the same line.
    const crlf = buildBewerbungAbsageEmail({ ...ABSAGE, grund: "Erster Grund\r\n-- \r\nZweiter Grund" });
    assert.ok(crlf.text.includes("\r\n -- \r\n"), "a CRLF reason's delimiter line was left standing");
  });

  it("declines the application without judging the school", () => {
    const mail = buildBewerbungAbsageEmail(ABSAGE);

    for (const branch of [readable(mail.html), flat(mail.text)]) {
      assert.ok(branch.includes("Die Entscheidung betrifft diese Bewerbung, nicht die Schule"));
    }
  });
});

describe("both messages", () => {
  it("are complete standalone documents with no external stylesheet or image", () => {
    for (const mail of [buildBewerbungZusageEmail(ZUSAGE), buildBewerbungAbsageEmail(ABSAGE)]) {
      assert.ok(mail.html.startsWith("<!doctype html>"));
      assert.ok(mail.html.includes(`<html lang="de">`));
      assert.ok(!/<link\b|<img\b|<style\b|<script\b/.test(mail.html), "email chrome must stay inline");
      assert.ok(mail.text.length > 0);
    }
  });

  it("offer the one contact route the product actually has", () => {
    for (const mail of [buildBewerbungZusageEmail(ZUSAGE), buildBewerbungAbsageEmail(ABSAGE)]) {
      assert.ok(mail.html.includes(`href="mailto:${KONTAKT_EMAIL}"`));
      assert.ok(mail.text.includes(KONTAKT_EMAIL));
    }
  });

  it("state the contact address once in the text branch", () => {
    // In HTML the two slots are a button and a footer note; the text branch has only the note.
    for (const mail of [buildBewerbungZusageEmail(ZUSAGE), buildBewerbungAbsageEmail(ABSAGE)]) {
      assert.equal(mail.text.split(KONTAKT_EMAIL).length - 1, 1, "the text branch repeats the address");
    }
  });

  it("close the text branch with RFC 3676's signature delimiter", () => {
    for (const mail of [buildBewerbungZusageEmail(ZUSAGE), buildBewerbungAbsageEmail(ABSAGE)]) {
      assert.ok(mail.text.includes("\n-- \n"), "without the trailing space no client folds the footer");
      // As a block: the delimiter opens the footer and each sentence holds its own place, so a pair
      // that traded places is a different footer rather than the same two sentences.
      assert.ok(mail.text.endsWith(`\n${TEXT_FOOTER}`), "the text branch no longer closes with the footer, in its order");
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
      })),
      ...hostileVariants(ABSAGE, "Absage", DELIMITER_VALUE).map((variant) => ({
        field: variant.field,
        mail: buildBewerbungAbsageEmail(variant.data),
      })),
    ];

    assert.ok(cases.length > 0, "no interpolated field was found at all, so this test proves nothing");
    for (const { field, mail } of cases) {
      assert.equal([...mail.text.matchAll(/^-- $/gm)].length, 1, `${field} stands as a second signature delimiter`);
      assert.ok(mail.text.includes("\n -- \n"), `${field}'s delimiter line was dropped rather than stuffed, so the reader loses it`);
      assert.ok(mail.text.includes("Zweite Zeile"), `${field} lost the line below its delimiter`);
      assert.ok(mail.text.endsWith(`\n${TEXT_FOOTER}`), `${field} pushed the footer out of the close`);
      // The markup branch states the same facts, so a value folded away in one branch only is two messages.
      assert.ok(readable(mail.html).includes("Zweite Zeile"), `${field} lost the line below its delimiter in the markup`);
    }
  });

  /* The end-of-body branch, which neither builder reaches: both bodies close on fixed copy. Read
     through the helper, the only route to it, because a body reordered to end on a value would fold
     its own footer away without it. */
  it("stuff a delimiter line standing at the very end of a body", () => {
    const stuffed = stuffSignatureDelimiter("Angegebener Grund:\nErste Zeile\n-- ");

    assert.equal(stuffed, "Angegebener Grund:\nErste Zeile\n -- ");
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
