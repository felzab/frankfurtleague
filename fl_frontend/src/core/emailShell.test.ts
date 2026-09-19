import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { assertEveryTokenIsRead, schemeTokens } from "./schemeReader.ts";

import type * as EmailShell from "./emailShell.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

/** The query that separates the hostile instance of the shell below from the one every other case renders through. */
const POISON_BRAND = "gift-marke";
/** A controller line carrying every character `escapeHtml` covers, which the real address does not. */
const POISON_CLUB = "Verein & Co.";
const POISON_ADDRESS = `c/o <Haus> "Süd", 60311 Frankfurt`;
const POISON_RESPONSIBLE = `${POISON_CLUB}, ${POISON_ADDRESS}`;
/** Its escaping written out rather than computed, so the expectation cannot follow the escaper it holds to account. */
const POISON_RESPONSIBLE_HTML = "Verein &amp; Co., c/o &lt;Haus&gt; &quot;Süd&quot;, 60311 Frankfurt";

/* The controller line reaches the card from a module constant, so a hostile one arrives only by
   replacing the brand module — the route that leaves production code with no test-only opening. */
const BRAND_DOUBLE_URL = `data:text/javascript,${encodeURIComponent(
  [
    `export const KONTAKT_EMAIL = "kontakt@beispiel.de";`,
    `export const VEREIN_NAME = ${JSON.stringify(POISON_CLUB)};`,
    `export const VEREIN_ANSCHRIFT = ${JSON.stringify(POISON_ADDRESS)};`,
  ].join("\n"),
)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    // The parent decides, so the double reaches the hostile instance alone and every other case
    // still renders against the real brand.
    if (specifier === "./brand" && (context.parentURL ?? "").includes(POISON_BRAND)) return { url: BRAND_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const {
  buildBewerbungAbsageEmail,
  buildBewerbungBestaetigungEmail,
  buildBewerbungEingangOffenEmail,
  buildBewerbungErinnerungEmail,
  buildBewerbungGeloeschtEmail,
  buildBewerbungVollstaendigEmail,
  buildBewerbungWiderspruchEmail,
  buildBewerbungZusageEmail,
} = await import("./bewerbungEmail.ts");
const { buildMagicLinkEmail } = await import("./authEmail.ts");
const { escapeHtml, renderKarte, stuffSignatureDelimiter } = await import("./emailShell.ts");
const { VEREIN_ANSCHRIFT, VEREIN_NAME } = await import("./brand.ts");

/** The origin the local stack serves from, which `docker-compose.local.yml` sets `AUTH_URL` to. */
const ORIGIN = "http://localhost:3000";

/** The shell as text, for the claims about its own shape that no return value carries. */
const SHELL_SOURCE = readFileSync(path.resolve(import.meta.dirname, "emailShell.ts"), "utf8");

/** One colour the shell declares, read off its source so a rename cannot quietly pass. */
function constant(name: string): string {
  const declared = SHELL_SOURCE.match(new RegExp(`const ${name} = "(#[0-9a-f]{3,8})";`))?.[1];

  // Throws rather than answering a sentence no colour matches: every reader below builds a pattern
  // from this, and a pattern matching nothing passes each of them having compared nothing.
  if (declared === undefined) throw new Error(`${name} is not declared as a lower-case hex literal`);

  return declared;
}

/**
 * The site's own tokens, read out of the season scheme rather than restated here. Nothing else pins
 * the email's palette to the app's: both are hand-written hex, and a token moving alone is invisible.
 */
const SCHEME = readFileSync(path.resolve(import.meta.dirname, "..", "app", "schemes", "2027.css"), "utf8");

/** The one stylesheet, contents included -- the only part of a message not stated inline. */
function stylesheet(html: string): string {
  return html.slice(html.indexOf("<style"), html.indexOf("</style>"));
}

/** The controls, which stand alone between the rule that sets them off and the one above the close. */
function controlSection(html: string): string {
  const first = html.indexOf("<hr");

  return html.slice(first, html.indexOf("<hr", first + 1));
}

/**
 * Every builder the two mail modules export, read off the module namespace rather than matched in
 * their source: a name no pattern anticipates would drop out of both sides of the register at once.
 */
const BUILT_MESSAGES = [...Object.keys(await import("./bewerbungEmail.ts")), ...Object.keys(await import("./authEmail.ts"))]
  .filter((name) => name.startsWith("build"))
  .sort();

/** One fixture per builder, keyed by the name the walk finds, carrying the least its signature needs. */
const FIXTURES: Record<string, (origin: string) => { html: string; text: string }> = {
  buildBewerbungZusageEmail: (origin) =>
    buildBewerbungZusageEmail({
      teamName: "Ernst-Reuter-Schule",
      saisonId: "2627",
      origin: origin,
      rollenText: "Ansprechperson",
      gruppe: "B",
      trikotFarbeLabel: "Hellgrün",
    }),
  buildBewerbungAbsageEmail: (origin) =>
    buildBewerbungAbsageEmail({
      teamName: "Ernst-Reuter-Schule",
      saisonId: "2627",
      origin: origin,
      rollenText: "Stellvertretung",
      grund: "Die Saison ist voll.",
    }),
  buildBewerbungBestaetigungEmail: (origin) =>
    buildBewerbungBestaetigungEmail({
      saisonId: "2627",
      origin: origin,
      schule: "Ernst-Reuter-Schule",
      seats: [{ vorname: "Erika", rolleText: "Ansprechperson", link: `${ORIGIN}/bestaetigung?token=beispiel-eins` }],
      fristText: "18.09.2026",
    }),
  buildBewerbungErinnerungEmail: (origin) =>
    buildBewerbungErinnerungEmail({
      saisonId: "2627",
      origin: origin,
      schule: "Ernst-Reuter-Schule",
      // Two seats on one address, which is the shape the single-seat fixture above cannot reach.
      seats: [
        { vorname: "Erika", rolleText: "Ansprechperson", link: `${ORIGIN}/bestaetigung?token=beispiel-zwei` },
        { vorname: "Jonas", rolleText: "Trainerin oder Trainer", link: `${ORIGIN}/bestaetigung?token=beispiel-drei` },
      ],
      fristText: "18.09.2026",
    }),
  buildBewerbungEingangOffenEmail: (origin) =>
    buildBewerbungEingangOffenEmail({
      saisonId: "2627",
      origin: origin,
      rollenText: "Ansprechperson",
      ausstehend: [{ vorname: "Jonas", rolleText: "Trainerin oder Trainer" }],
      fristText: "18.09.2026",
      link: `${ORIGIN}/bestaetigung?token=beispiel-vier`,
    }),
  buildBewerbungVollstaendigEmail: (origin) =>
    buildBewerbungVollstaendigEmail({ saisonId: "2627", origin: origin, rollenText: "Ansprechperson" }),
  buildBewerbungGeloeschtEmail: (origin) =>
    buildBewerbungGeloeschtEmail({
      saisonId: "2627",
      origin: origin,
      rollenText: "Ansprechperson",
      ausstehend: [{ vorname: "Jonas", rolleText: "Trainerin oder Trainer" }],
    }),
  buildBewerbungWiderspruchEmail: (origin) =>
    buildBewerbungWiderspruchEmail({
      saisonId: "2627",
      origin: origin,
      rollenText: "Ansprechperson",
      abgelehnt: { vorname: "Jonas", rolleText: "Trainerin oder Trainer" },
      fristText: "18.09.2026",
    }),
  buildMagicLinkEmail: (origin) => buildMagicLinkEmail("https://frankfurtleague.de/api/auth/callback/resend?token=abc&email=a%40b.de", origin),
};

/** Every message the two mail modules build, so a design claim is checked against all of them rather than against one. */
const MESSAGES = Object.entries(FIXTURES).map(([name, bauen]) => ({ name, mail: bauen(ORIGIN) }));

describe("the shared email shell", () => {
  /* Both directions, so neither side can be satisfied by the other shrinking: a builder with no
     fixture fails here rather than dropping out of every sweep, and a stale fixture fails too. */
  it("sweeps every message builder the mail modules export", () => {
    // The sign-in link, the two decisions and the confirmation workflow's six. A walk finding fewer
    // has stopped reading the modules, and every sweep below then runs over nothing.
    assert.ok(BUILT_MESSAGES.length >= 9, `expected at least 9 message builders, found ${String(BUILT_MESSAGES.length)}`);
    assert.deepEqual(BUILT_MESSAGES, Object.keys(FIXTURES).sort(), "a message builder has no fixture, or a fixture names no builder");
  });

  /* The one origin every close is built on. Read over the walked register rather than per builder:
     a tenth message added tomorrow reaches this on the edit that adds it. */
  it("builds every message's close on the origin the builder was handed", () => {
    const foreign = "https://beispiel.test";

    for (const [name, bauen] of Object.entries(FIXTURES)) {
      const mail = bauen(foreign);

      for (const page of ["datenschutz", "impressum"]) {
        assert.ok(mail.html.includes(`href="${foreign}/${page}"`), `${name}'s close links ${page} on some other origin`);
        assert.ok(mail.text.includes(`: ${foreign}/${page}`), `${name}'s text branch closes on ${page} at some other origin`);
      }
    }
  });

  /* `SKIP_ENV_VALIDATION` lets the builder stage and this test run past `config.ts`'s gate, so a
     builder composing around an absent `AUTH_URL` would mail a close no reader can follow. */
  it("refuses to build a message at all where the origin is not an absolute URL", () => {
    for (const [name, bauen] of Object.entries(FIXTURES)) {
      assert.throws(() => bauen(""), /absolute origin/, `${name} composed a message on an origin that is not a URL`);
      assert.throws(() => bauen("/bestaetigung"), /absolute origin/, `${name} composed a message on a bare path`);
    }
  });

  it("draws every message as a complete standalone document with no external stylesheet or image", () => {
    for (const { name, mail } of MESSAGES) {
      assert.ok(mail.html.startsWith("<!doctype html>"), `${name} is not a whole document`);
      assert.ok(mail.html.includes(`<html lang="de">`));
      assert.ok(!/<link\b|<img\b|<script\b/.test(mail.html), "email chrome must stay self-contained");
      // One stylesheet, in the head, and nothing else out of line. Gmail drops a `<style>` in the
      // body and caps it at 16 KB; this one is a few hundred bytes of constants.
      assert.equal([...mail.html.matchAll(/<style\b/g)].length, 1, `${name} carries more than one stylesheet`);
      assert.ok(mail.html.indexOf("<style") < mail.html.indexOf("</head>"), `${name}'s stylesheet fell out of the head`);
      assert.ok(mail.text.length > 0);
    }
  });

  /* Word ignores `max-width` and applies a `<div>`'s padding unevenly, so a card built from divs
     reaches Outlook on Windows full width and flush to the edge. Tables, and the width restated. */
  it("carries its layout in tables Outlook on Windows will actually honour", () => {
    for (const { name, mail } of MESSAGES) {
      assert.ok(!mail.html.includes("<div"), `${name} carries layout in a div`);

      const ghost = mail.html.match(/<!--\[if mso\]><table [^>]*width="(\d+)"/);
      const width = mail.html.match(/max-width:(\d+)px/);

      assert.ok(ghost !== null && width !== null, `${name} does not restate its width for the Word engine`);
      // One number in two places: restating only one leaves Outlook drawing a card of its own width.
      assert.equal(ghost?.[1], width?.[1], `${name}'s Outlook width and its max-width disagree`);
      // A layout table read aloud row by row is unusable, and the role is not inherited by a nested one.
      for (const table of mail.html.matchAll(/<table[^>]*>/g)) {
        assert.ok((table[0] ?? "").includes(`role="presentation"`), `${name} has a layout table without a role`);
      }
    }
  });

  /* Light-first with a dark override: the clients that ignore the query force an inversion of their
     own, which drives a dark-first message light while its text stays on the dark palette. */
  it("declares the colour schemes it is drawn in and ships rules for both", () => {
    for (const { name, mail } of MESSAGES) {
      assert.ok(mail.html.includes(`<meta name="color-scheme" content="light dark" />`), `${name} declares no colour scheme`);
      assert.ok(mail.html.includes(`<meta name="supported-color-schemes" content="light dark" />`), `${name} omits the Apple spelling`);
      // Declaring dark without shipping dark rules invites a client to invent its own instead.
      assert.ok(mail.html.includes("@media (prefers-color-scheme: dark)"), `${name} claims dark it does not carry`);
      assert.ok(mail.html.includes(`<meta charset="utf-8" />`), `${name} leaves its encoding to the transport alone`);
    }
  });

  /* I asked for the site's dark mode rather than a dark mode of the email's own. */
  it("draws both themes in the site's own tokens", () => {
    const light = schemeTokens(SCHEME, "light");
    const dark = schemeTokens(SCHEME, "dark");

    assertEveryTokenIsRead(SCHEME);
    for (const [name, token, palette] of [
      ["CARD_COLOR", "--bg-base", light],
      ["SURFACE_COLOR", "--bg-surface", light],
      ["TEXT_COLOR", "--fg-muted", light],
      ["HEADING_COLOR", "--fg-base", light],
      ["RULE_COLOR", "--border-base", light],
      ["BRAND_COLOR", "--accent-brand", light],
      ["BRAND_SOLID_COLOR", "--accent-brand-solid", light],
      ["ON_BRAND_COLOR", "--fg-on-brand", light],
      ["DARK_CARD_COLOR", "--bg-base", dark],
      ["DARK_SURFACE_COLOR", "--bg-surface", dark],
      ["DARK_TEXT_COLOR", "--fg-muted", dark],
      ["DARK_HEADING_COLOR", "--fg-base", dark],
      ["DARK_RULE_COLOR", "--border-base", dark],
      ["DARK_BRAND_COLOR", "--accent-brand", dark],
      ["ON_BRAND_COLOR", "--fg-on-brand", dark],
    ] as const) {
      assert.equal(constant(name), palette.get(token), `${name} has drifted from ${token}`);
    }
    // The button fill is `--accent-brand-solid`, which deliberately does NOT flip; the dark rules
    // must therefore leave it alone, or the button's pill takes a second colour in one theme.
    assert.equal(light.get("--accent-brand-solid"), dark.get("--accent-brand-solid"));
    // `ON_BRAND_COLOR` is checked against the light token alone, which is safe only while the label
    // on that unflipping fill does not flip either.
    assert.equal(light.get("--fg-on-brand"), dark.get("--fg-on-brand"));
    for (const { name, mail } of MESSAGES) {
      assert.ok(!stylesheet(mail.html).includes(`background-color: ${constant("DARK_BRAND_COLOR")}`), `${name} flips a fill the site does not`);
      // An inline style outranks a rule, so a dark declaration without this is a rule that never lands.
      const darkBlock = stylesheet(mail.html).slice(stylesheet(mail.html).indexOf("prefers-color-scheme"));
      const rules = [...darkBlock.slice(0, darkBlock.indexOf("\n      }")).matchAll(/[a-z-]+: [^;]+;/g)].map((m) => m[0] ?? "");

      assert.ok(rules.length >= 8, `${name} carries almost no dark declarations`);
      for (const rule of rules) assert.ok(rule.includes("!important"), `${name}'s „${rule}“ loses to the inline style`);
    }
  });

  /* A class with no rule is decoration; a rule with no class is dead. The corpus decides the second
     direction: only the application messages carry a facts panel, and the shell is shared. */
  it("hooks every dark rule to a class some message actually carries", () => {
    const allClasses = new Set<string>();

    for (const { name, mail } of MESSAGES) {
      // Every mention, not only a rule opening one: the stacking rule names three in one selector.
      const rules = new Set([...stylesheet(mail.html).matchAll(/\.(fl-[a-z-]+)/g)].map((hit) => hit[1] ?? ""));
      const worn = new Set([...mail.html.matchAll(/class="([^"]+)"/g)].flatMap((hit) => (hit[1] ?? "").split(" ")));

      assert.ok(rules.size >= 6, `${name} carries no dark rules, so this test proves nothing`);
      for (const className of worn) {
        assert.ok(rules.has(className), `${name} carries .${className}, which no rule reaches`);
        allClasses.add(className);
      }
      for (const rule of rules) assert.ok(SHELL_SOURCE.includes(`"${rule}"`) || rule === "fl-actions", `.${rule} is spelled nowhere`);
    }

    const rules = new Set([...stylesheet(MESSAGES[0]?.mail.html ?? "").matchAll(/\.(fl-[a-z-]+)/g)].map((hit) => hit[1] ?? ""));
    for (const rule of rules) assert.ok(allClasses.has(rule), `.${rule} is styled and no message carries it`);
  });

  /* Every themed colour needs the hook that flips it. Checked per element rather than per class:
     one heading losing its hook leaves the class on its siblings and the set-level check green. */
  it("hooks every themed colour on the element that declares it", () => {
    const HOOKS = [
      { declaration: `color:${constant("HEADING_COLOR")};`, className: "fl-head" },
      { declaration: `color:${constant("TEXT_COLOR")};`, className: "fl-text" },
      { declaration: `color:${constant("BRAND_COLOR")};`, className: "fl-brand" },
      { declaration: `background-color:${constant("SURFACE_COLOR")};`, className: "fl-page|fl-panel" },
      { declaration: `background-color:${constant("CARD_COLOR")};`, className: "fl-card" },
    ];

    for (const { name, mail } of MESSAGES) {
      const tags = [...mail.html.matchAll(/<[a-z][^>]*style="[^"]*"[^>]*>/g)].map((hit) => hit[0]);

      assert.ok(tags.length > 10, `${name} has almost no styled elements, so this test proves nothing`);
      for (const tag of tags) {
        for (const { declaration, className } of HOOKS) {
          // Anchored, because `color:` is also the tail of `background-color:` -- the button fill,
          // which is `--accent-brand-solid` and must NOT flip.
          if (!new RegExp(`[;"]${declaration}`).test(tag)) continue;
          const worn = tag.match(/class="([^"]+)"/)?.[1] ?? "";
          assert.ok(
            className.split("|").some((single) => worn.split(" ").includes(single)),
            `${name} declares „${declaration}“ with no dark hook: ${tag.slice(0, 90)}`,
          );
        }
      }
      /* `--fg-on-brand` is white in BOTH themes and sits on a fill that does not flip, so the button's
         label must carry no hook at all -- one would turn it grey on the brand pill. */
      const unflipped = tags.filter((single) => new RegExp(`[;"]color:${constant("ON_BRAND_COLOR")};`).test(single));

      // The filter is the population, so without this an empty one passes the loop below having
      // compared nothing -- which is what a respelt foreground or a dropped button would leave.
      assert.ok(unflipped.length > 0, `${name} declares the unflipped foreground nowhere, so this check proves nothing`);
      for (const tag of unflipped) {
        assert.ok(!tag.includes("fl-"), `${name} hooks the unflipped foreground: ${tag.slice(0, 90)}`);
      }
    }
  });

  /* Both are #ffffff here, so a swap renders identically and no output can tell them apart. Pinned
     at the source because they are different tokens: the dark theme moves the card, not this. */
  it("labels the brand fill with the foreground paired to it, not the card colour", () => {
    const button = SHELL_SOURCE.slice(SHELL_SOURCE.indexOf("function aktionZelle"), SHELL_SOURCE.indexOf("function renderAktionen"));

    assert.match(button, /color:\$\{ON_BRAND_COLOR\}/, "the button label no longer names the foreground paired to the fill");
    assert.ok(!button.includes("CARD_COLOR"), "the button label follows the card colour");
    assert.match(button, /background-color:\$\{BRAND_SOLID_COLOR\}/, "the button fill is not the token that stays put");
  });

  /**
   * The landing page's own recipe, whose classes carry the design a mail client cannot be handed:
   * a change there is a change the buttons below have to follow, and nothing else would say so.
   */
  const CTA_SOURCE = readFileSync(path.resolve(import.meta.dirname, "..", "shared", "components", "ui", "formButtons.ts"), "utf8");
  const CTA_RECIPE = CTA_SOURCE.slice(CTA_SOURCE.indexOf("const ctaButtonStyle"), CTA_SOURCE.indexOf("export function ctaButton"));

  /** One control as the markup states it: the cell carries fill, border and radius, the anchor the type and the hit area. */
  function buttons(html: string): { cell: string; anchor: string }[] {
    return [...controlSection(html).matchAll(/<td align="center"([^>]*)>([\s\S]*?)<\/td>/g)].map((hit) => ({
      cell: hit[1] ?? "",
      anchor: (hit[2] ?? "").match(/<a [^>]*>/)?.[0] ?? "",
    }));
  }

  const number = (tag: string, pattern: RegExp): number => Number(tag.match(pattern)?.[1] ?? NaN);

  it("still mirrors a landing-page recipe that spells the design it was copied from", () => {
    for (const className of [
      "h-12",
      "px-6",
      "rounded-xl",
      "font-bold",
      "bg-brand-solid",
      "text-brand-solid-foreground",
      "shadow-md",
      "border-border",
      "bg-transparent",
      "text-foreground",
    ]) {
      assert.ok(CTA_RECIPE.includes(className), `ctaButton no longer spells „${className}“, so the email buttons no longer match it`);
    }
  });

  /* `h-12` is 48px and no `<td>` honours a utility class, so the height is padding either side of one
     line box. The border counts into the same box, which is why the outline control's padding is 1px
     short of the filled one's on both axes. */
  it("gives every control the 48px box, the 12px radius and the 700 weight ctaButton gives it", () => {
    for (const { name, mail } of MESSAGES) {
      const all = buttons(mail.html);

      assert.ok(all.length >= 1, `${name} renders no control at all, so this test proves nothing`);
      for (const { cell, anchor } of all) {
        const outlined = cell.includes("border:1px solid");
        const height = number(anchor, /padding:(\d+)px/);
        const width = number(anchor, /padding:\d+px (\d+)px/);
        const line = number(anchor, /line-height:(\d+)px/);

        assert.equal(number(cell, /border-radius:(\d+)px/), 12, `${name} rounds a control off ctaButton's rounded-xl`);
        assert.ok(anchor.includes("font-weight:700;"), `${name} sets a control below ctaButton's font-bold`);
        assert.ok(anchor.includes("display:inline-block;"), `${name} leaves a control's padded area unclickable`);
        assert.equal(height * 2 + line + (outlined ? 2 : 0), 48, `${name}'s control is not ctaButton's h-12`);
        assert.equal(width + (outlined ? 1 : 0), 24, `${name}'s control is not ctaButton's px-6`);
      }
    }
  });

  /* `bg-brand-solid` with `shadow-md`, and `bg-transparent` with `border-border`: the outline grade
     rests on the card, so it declares no fill of its own and needs no second dark rule to follow it. */
  it("grades a pair as ctaButton grades one, filled first and outlined beside it", () => {
    // Found by its pair rather than by an index into the walked population, whose order is a
    // directory listing's and moves when a builder is renamed.
    const pair = MESSAGES.map(({ mail }) => buttons(mail.html)).find((candidate) => candidate.length === 2) ?? [];

    assert.equal(pair.length, 2, "the application messages no longer offer a pair, so this test proves nothing");
    assert.ok(pair[0]?.cell.includes(`background-color:${constant("BRAND_SOLID_COLOR")};`), "the primary control lost its fill");
    assert.ok(pair[0]?.cell.includes("box-shadow:"), "the primary control lost shadow-md");
    assert.ok(pair[1]?.cell.includes(`border:1px solid ${constant("RULE_COLOR")};`), "the outline control lost its border");
    assert.ok(!pair[1]?.cell.includes("background-color"), "the outline control declares a fill ctaButton leaves transparent");
    assert.ok(pair[1]?.anchor.includes(`color:${constant("HEADING_COLOR")};`), "the outline control's label is not text-foreground");
  });

  /* `Aktion.href` and `Aktion.label` are interface fields. Today's two callers hand them module
     constants, so no rendered message reaches this guard -- and no fixture reaches it either,
     which is exactly where a third caller would lean on it. */
  it("escapes a control's own destination and label", () => {
    const card = renderKarte({
      titel: "Anmeldung",
      ueberschrift: "Anmeldung",
      bloecke: [],
      aktionen: [
        { href: `https://frankfurtleague.de/a?b="c"&d=<e>`, label: `Frage <b>"stellen"</b>`, ton: "primary" },
        { href: `https://frankfurtleague.de/f?g='h'&i=<j>`, label: `Laufende <i>'Saison'</i>`, ton: "outline" },
      ],
      fuss: "Antworten liest niemand.",
      origin: ORIGIN,
    });

    assert.ok(card.includes(`href="https://frankfurtleague.de/a?b=&quot;c&quot;&amp;d=&lt;e&gt;"`), "the filled control's destination is raw");
    assert.ok(card.includes(`href="https://frankfurtleague.de/f?g=&#39;h&#39;&amp;i=&lt;j&gt;"`), "the outline control's destination is raw");
    assert.ok(card.includes("Frage &lt;b&gt;&quot;stellen&quot;&lt;/b&gt;"), "the filled control's label is raw");
    assert.ok(card.includes("Laufende &lt;i&gt;&#39;Saison&#39;&lt;/i&gt;"), "the outline control's label is raw");
  });

  /* Outlook has no flexbox, so a row of controls is a row of cells; the stylesheet turns them into
     blocks below the card's width, which is where a row of two stops fitting. */
  it("stacks its controls where a row will not fit", () => {
    for (const { name, mail } of MESSAGES) {
      assert.ok(mail.html.includes("@media (max-width: 480px)"), `${name} has no rule to stack on a narrow screen`);
      assert.match(stylesheet(mail.html), /\.fl-actions[^}]*display: block !important/, `${name}'s stack rule does not stack`);
      for (const { cell } of buttons(mail.html)) assert.ok(cell.includes("fl-action"), `${name} has a control the stack rule cannot reach`);
    }
  });

  it("closes every message on both legal pages and the controller, in both branches", () => {
    const responsible = `${VEREIN_NAME}, ${VEREIN_ANSCHRIFT}`;
    const pages = [
      { label: "Datenschutzerklärung", href: `${ORIGIN}/datenschutz` },
      { label: "Impressum", href: `${ORIGIN}/impressum` },
    ];
    const textClosing = [...pages.map(({ label, href }) => `${label}: ${href}`), responsible].join("\n");

    for (const { name, mail } of MESSAGES) {
      const closing = mail.html.slice(mail.html.lastIndexOf("<hr"));

      for (const { label, href } of pages) {
        assert.ok(closing.includes(`href="${href}"`), `${name}'s close does not link ${label}`);
        // The label as the anchor's own text: a URL a reader has to read to know where it goes is
        // the thing the link exists to replace.
        assert.ok(closing.includes(`>${label}</a>`), `${name}'s close links ${href} under some other name`);
      }
      assert.ok(closing.includes(responsible), `${name}'s close does not name the controller`);
      assert.ok(mail.text.endsWith(`\n${textClosing}`), `${name}'s text branch does not close on the legal lines, in order`);
    }
  });

  /* The controller line is the close's one interpolation with no caller to escape it and no helper
     in its path; the address is replaced by hand, where a c/o line carrying `&` is ordinary. */
  it("carries the controller line into both branches of every message", () => {
    const responsible = `${VEREIN_NAME}, ${VEREIN_ANSCHRIFT}`;

    for (const { name, mail } of MESSAGES) {
      assert.ok(mail.html.includes(escapeHtml(responsible)), `${name}'s card does not carry the controller escaped`);
      assert.ok(mail.text.endsWith(responsible), `${name}'s text branch does not close on the controller raw`);
    }
  });

  /* Today's address escapes to itself, so the sweep above passes an unescaped card too. Held here
     against an address carrying markup, which is what a c/o line and an „&“ in a name produce. */
  it("escapes a controller line carrying markup, and leaves the text branch raw", async () => {
    const shell = (await import(`./emailShell.ts?${POISON_BRAND}`)) as typeof EmailShell;
    const card = shell.renderKarte({
      titel: "Anmeldung",
      ueberschrift: "Anmeldung",
      bloecke: [],
      aktionen: [],
      fuss: "Antworten liest niemand.",
      origin: ORIGIN,
    });
    const closing = card.slice(card.lastIndexOf("<hr"));

    assert.ok(closing.includes(POISON_RESPONSIBLE_HTML), "the card carries a controller line the escaper did not reach");
    assert.ok(!closing.includes(POISON_ADDRESS), "the card carries the address raw, which a „<“ in it makes markup");
    // The text branch takes the address as typed: no client parses it, and an escaped „&“ there
    // reaches the reader as five characters.
    assert.deepEqual(shell.textFooter(ORIGIN, []), [
      "",
      "-- ",
      `Datenschutzerklärung: ${ORIGIN}/datenschutz`,
      `Impressum: ${ORIGIN}/impressum`,
      POISON_RESPONSIBLE,
    ]);
  });

  /* The end-of-body branch, which no builder reaches: every body closes on fixed copy. Read through
     the helper, the only route to it, because a body reordered to end on a value would fold its own
     footer away without it. */
  it("stuffs a delimiter line standing at the very end of a body", () => {
    assert.equal(stuffSignatureDelimiter("Angegebener Grund:\nErste Zeile\n-- "), "Angegebener Grund:\nErste Zeile\n -- ");
  });

  /* All three line endings the pattern lists. A stored value is not held to what a browser sends, so
     with only the line feed covered a value broken by a lone carriage return folds the message at its
     own delimiter — the ending the alternation exists for. */
  for (const [was, umbruch] of [
    ["a line feed", "\n"],
    ["a carriage return and line feed", "\r\n"],
    ["a lone carriage return", "\r"],
  ]) {
    it(`stuffs a delimiter line broken by ${was}`, () => {
      assert.equal(
        stuffSignatureDelimiter(`Erste Zeile${umbruch}-- ${umbruch}Zweite Zeile`),
        `Erste Zeile${umbruch} -- ${umbruch}Zweite Zeile`,
      );
    });
  }

  /* Two in a row: the pattern's lookahead leaves the break it matched unconsumed, so the second
     delimiter is still at the start of the next search rather than skipped past. */
  it("stuffs two delimiter lines standing together", () => {
    assert.equal(stuffSignatureDelimiter("Erste\n-- \n-- \nZweite"), "Erste\n -- \n -- \nZweite");
  });
});
