import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { buildBewerbungAbsageEmail, buildBewerbungEingangEmail, buildBewerbungZusageEmail } = await import("./bewerbungEmail.ts");
const { buildMagicLinkEmail } = await import("./authEmail.ts");
const { renderKarte, stuffSignatureDelimiter } = await import("./emailShell.ts");

/** The shell as text, for the claims about its own shape that no return value carries. */
const SHELL_SOURCE = readFileSync(path.resolve(import.meta.dirname, "emailShell.ts"), "utf8");

/** One colour the shell declares, read off its source so a rename cannot quietly pass. */
function constant(name: string): string {
  return SHELL_SOURCE.match(new RegExp(`const ${name} = "(#[0-9a-f]{3,8})";`))?.[1] ?? `${name} is not declared`;
}

/**
 * The site's own tokens, read out of `globals.css` rather than restated here. Nothing else pins the
 * email's palette to the app's: both are hand-written hex, and a token moving alone is invisible.
 */
function tokens(theme: "light" | "dark"): Map<string, string> {
  const css = readFileSync(path.resolve(import.meta.dirname, "..", "app", "globals.css"), "utf8");
  const opener = theme === "light" ? ":root," : `[data-theme="dark"] {`;
  const block = css.slice(css.indexOf(opener));

  return new Map(
    [...block.slice(0, block.indexOf("\n  }")).matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3,8});/g)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );
}

/** The one stylesheet, contents included -- the only part of a message not stated inline. */
function stylesheet(html: string): string {
  return html.slice(html.indexOf("<style"), html.indexOf("</style>"));
}

/** The controls, which stand alone between the rule that sets them off and the one above the close. */
function steuerBereich(html: string): string {
  const erste = html.indexOf("<hr");

  return html.slice(erste, html.indexOf("<hr", erste + 1));
}

/**
 * Every message the app sends, so a design claim is checked against all of them rather than against
 * the three that happen to share a builder.
 */
const NACHRICHTEN = [
  {
    name: "Zusage",
    mail: buildBewerbungZusageEmail({
      teamName: "Ernst-Reuter-Schule",
      saisonId: "2627",
      rollenText: "Ansprechperson",
      gruppe: "B",
      trikotFarbeLabel: "Hellgrün",
    }),
  },
  {
    name: "Absage",
    mail: buildBewerbungAbsageEmail({
      teamName: "Ernst-Reuter-Schule",
      saisonId: "2627",
      rollenText: "Stellvertretung",
      grund: "Die Saison ist voll.",
    }),
  },
  { name: "Eingang", mail: buildBewerbungEingangEmail({ saisonId: "2627", rollenText: "Ansprechperson" }) },
  { name: "Anmeldung", mail: buildMagicLinkEmail("https://frankfurtleague.de/api/auth/callback/resend?token=abc&email=a%40b.de") },
] as const;

describe("the shared email shell", () => {
  it("draws every message as a complete standalone document with no external stylesheet or image", () => {
    for (const { name, mail } of NACHRICHTEN) {
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
    for (const { name, mail } of NACHRICHTEN) {
      assert.ok(!mail.html.includes("<div"), `${name} carries layout in a div`);

      const geist = mail.html.match(/<!--\[if mso\]><table [^>]*width="(\d+)"/);
      const breite = mail.html.match(/max-width:(\d+)px/);

      assert.ok(geist !== null && breite !== null, `${name} does not restate its width for the Word engine`);
      // One number in two places: restating only one leaves Outlook drawing a card of its own width.
      assert.equal(geist?.[1], breite?.[1], `${name}'s Outlook width and its max-width disagree`);
      // A layout table read aloud row by row is unusable, and the role is not inherited by a nested one.
      for (const tabelle of mail.html.matchAll(/<table[^>]*>/g)) {
        assert.ok((tabelle[0] ?? "").includes(`role="presentation"`), `${name} has a layout table without a role`);
      }
    }
  });

  /* Light-first with a dark override: the clients that ignore the query force an inversion of their
     own, which drives a dark-first message light while its text stays on the dark palette. */
  it("declares the colour schemes it is drawn in and ships rules for both", () => {
    for (const { name, mail } of NACHRICHTEN) {
      assert.ok(mail.html.includes(`<meta name="color-scheme" content="light dark" />`), `${name} declares no colour scheme`);
      assert.ok(mail.html.includes(`<meta name="supported-color-schemes" content="light dark" />`), `${name} omits the Apple spelling`);
      // Declaring dark without shipping dark rules invites a client to invent its own instead.
      assert.ok(mail.html.includes("@media (prefers-color-scheme: dark)"), `${name} claims dark it does not carry`);
      assert.ok(mail.html.includes(`<meta charset="utf-8" />`), `${name} leaves its encoding to the transport alone`);
    }
  });

  /* I asked for the site's dark mode rather than a dark mode of the email's own. Both palettes are
     read from `globals.css` so the two cannot drift: a token moved in the app and not here would
     otherwise ship silently. */
  it("draws both themes in the site's own tokens", () => {
    const hell = tokens("light");
    const dunkel = tokens("dark");

    assert.ok(hell.size > 5 && dunkel.size > 5, "globals.css was not parsed, so this test proves nothing");
    for (const [name, token, palette] of [
      ["CARD_COLOR", "--bg-base", hell],
      ["SURFACE_COLOR", "--bg-surface", hell],
      ["TEXT_COLOR", "--fg-muted", hell],
      ["HEADING_COLOR", "--fg-base", hell],
      ["RULE_COLOR", "--border-base", hell],
      ["BRAND_COLOR", "--accent-brand", hell],
      ["BRAND_SOLID_COLOR", "--accent-brand-solid", hell],
      ["ON_BRAND_COLOR", "--fg-on-brand", hell],
      ["DARK_CARD_COLOR", "--bg-base", dunkel],
      ["DARK_SURFACE_COLOR", "--bg-surface", dunkel],
      ["DARK_TEXT_COLOR", "--fg-muted", dunkel],
      ["DARK_HEADING_COLOR", "--fg-base", dunkel],
      ["DARK_RULE_COLOR", "--border-base", dunkel],
      ["DARK_BRAND_COLOR", "--accent-brand", dunkel],
      ["ON_BRAND_COLOR", "--fg-on-brand", dunkel],
    ] as const) {
      assert.equal(constant(name), palette.get(token), `${name} has drifted from ${token}`);
    }
    // The button fill is `--accent-brand-solid`, which deliberately does NOT flip; the dark rules
    // must therefore leave it alone, or a maroon pill turns pink on one theme only.
    assert.equal(hell.get("--accent-brand-solid"), dunkel.get("--accent-brand-solid"));
    // `ON_BRAND_COLOR` is checked against the light token alone, which is safe only while the label
    // on that unflipping fill does not flip either.
    assert.equal(hell.get("--fg-on-brand"), dunkel.get("--fg-on-brand"));
    for (const { name, mail } of NACHRICHTEN) {
      assert.ok(!stylesheet(mail.html).includes(`background-color: ${constant("DARK_BRAND_COLOR")}`), `${name} flips a fill the site does not`);
      // An inline style outranks a rule, so a dark declaration without this is a rule that never lands.
      const dunkelBlock = stylesheet(mail.html).slice(stylesheet(mail.html).indexOf("prefers-color-scheme"));
      const regeln = [...dunkelBlock.slice(0, dunkelBlock.indexOf("\n      }")).matchAll(/[a-z-]+: [^;]+;/g)].map((m) => m[0] ?? "");

      assert.ok(regeln.length >= 8, `${name} carries almost no dark declarations`);
      for (const regel of regeln) assert.ok(regel.includes("!important"), `${name}'s „${regel}“ loses to the inline style`);
    }
  });

  /* A class with no rule is decoration; a rule with no class is dead. The corpus decides the second
     direction: only the application messages carry a facts panel, and the shell is shared. */
  it("hooks every dark rule to a class some message actually carries", () => {
    const alleKlassen = new Set<string>();

    for (const { name, mail } of NACHRICHTEN) {
      // Every mention, not only a rule opening one: the stacking rule names three in one selector.
      const regeln = new Set([...stylesheet(mail.html).matchAll(/\.(fl-[a-z-]+)/g)].map((treffer) => treffer[1] ?? ""));
      const getragen = new Set([...mail.html.matchAll(/class="([^"]+)"/g)].flatMap((treffer) => (treffer[1] ?? "").split(" ")));

      assert.ok(regeln.size >= 6, `${name} carries no dark rules, so this test proves nothing`);
      for (const klasse of getragen) {
        assert.ok(regeln.has(klasse), `${name} carries .${klasse}, which no rule reaches`);
        alleKlassen.add(klasse);
      }
      for (const regel of regeln) assert.ok(SHELL_SOURCE.includes(`"${regel}"`) || regel === "fl-actions", `.${regel} is spelled nowhere`);
    }

    const regeln = new Set([...stylesheet(NACHRICHTEN[0].mail.html).matchAll(/\.(fl-[a-z-]+)/g)].map((treffer) => treffer[1] ?? ""));
    for (const regel of regeln) assert.ok(alleKlassen.has(regel), `.${regel} is styled and no message carries it`);
  });

  /* Every themed colour needs the hook that flips it. Checked per element rather than per class:
     one heading losing its hook leaves the class on its siblings and the set-level check green. */
  it("hooks every themed colour on the element that declares it", () => {
    const HOOKS = [
      { declaration: `color:${constant("HEADING_COLOR")};`, klasse: "fl-head" },
      { declaration: `color:${constant("TEXT_COLOR")};`, klasse: "fl-text" },
      { declaration: `color:${constant("BRAND_COLOR")};`, klasse: "fl-brand" },
      { declaration: `background-color:${constant("SURFACE_COLOR")};`, klasse: "fl-page|fl-panel" },
      { declaration: `background-color:${constant("CARD_COLOR")};`, klasse: "fl-card" },
    ];

    for (const { name, mail } of NACHRICHTEN) {
      const tags = [...mail.html.matchAll(/<[a-z][^>]*style="[^"]*"[^>]*>/g)].map((treffer) => treffer[0]);

      assert.ok(tags.length > 10, `${name} has almost no styled elements, so this test proves nothing`);
      for (const tag of tags) {
        for (const { declaration, klasse } of HOOKS) {
          // Anchored, because `color:` is also the tail of `background-color:` -- the button fill,
          // which is `--accent-brand-solid` and must NOT flip.
          if (!new RegExp(`[;"]${declaration}`).test(tag)) continue;
          const getragen = tag.match(/class="([^"]+)"/)?.[1] ?? "";
          assert.ok(
            klasse.split("|").some((einzeln) => getragen.split(" ").includes(einzeln)),
            `${name} declares „${declaration}“ with no dark hook: ${tag.slice(0, 90)}`,
          );
        }
      }
      /* `--fg-on-brand` is white in BOTH themes and sits on a fill that does not flip, so the button's
         label must carry no hook at all -- one would turn it grey on a maroon pill. */
      for (const tag of tags.filter((einzeln) => /[;"]color:#ffffff;/.test(einzeln))) {
        assert.ok(!tag.includes("fl-"), `${name} hooks the unflipped foreground: ${tag.slice(0, 90)}`);
      }
    }
  });

  /* Both are #ffffff here, so a swap renders identically and no output can tell them apart. Pinned
     at the source because they are different tokens: the dark theme moves the card, not this. */
  it("labels the brand fill with the foreground paired to it, not the card colour", () => {
    const knopf = SHELL_SOURCE.slice(SHELL_SOURCE.indexOf("function aktionZelle"), SHELL_SOURCE.indexOf("function renderAktionen"));

    assert.match(knopf, /color:\$\{ON_BRAND_COLOR\}/, "the button label no longer names the foreground paired to the fill");
    assert.ok(!knopf.includes("CARD_COLOR"), "the button label follows the card colour");
    assert.match(knopf, /background-color:\$\{BRAND_SOLID_COLOR\}/, "the button fill is not the token that stays put");
  });

  /**
   * The landing page's own recipe, whose classes carry the design a mail client cannot be handed:
   * a change there is a change the buttons below have to follow, and nothing else would say so.
   */
  const CTA_SOURCE = readFileSync(path.resolve(import.meta.dirname, "..", "shared", "components", "ui", "formButtons.ts"), "utf8");
  const CTA_RECIPE = CTA_SOURCE.slice(CTA_SOURCE.indexOf("const ctaButtonStyle"), CTA_SOURCE.indexOf("export function ctaButton"));

  /** One control as the markup states it: the cell carries fill, border and radius, the anchor the type and the hit area. */
  function knoepfe(html: string): { zelle: string; anker: string }[] {
    return [...steuerBereich(html).matchAll(/<td align="center"([^>]*)>([\s\S]*?)<\/td>/g)].map((treffer) => ({
      zelle: treffer[1] ?? "",
      anker: (treffer[2] ?? "").match(/<a [^>]*>/)?.[0] ?? "",
    }));
  }

  const zahl = (tag: string, muster: RegExp): number => Number(tag.match(muster)?.[1] ?? NaN);

  it("still mirrors a landing-page recipe that spells the design it was copied from", () => {
    for (const klasse of [
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
      assert.ok(CTA_RECIPE.includes(klasse), `ctaButton no longer spells „${klasse}“, so the email buttons no longer match it`);
    }
  });

  /* `h-12` is 48px and no `<td>` honours a utility class, so the height is padding either side of one
     line box. The border counts into the same box, which is why the outline control's padding is 1px
     short of the filled one's on both axes. */
  it("gives every control the 48px box, the 12px radius and the 700 weight ctaButton gives it", () => {
    for (const { name, mail } of NACHRICHTEN) {
      const alle = knoepfe(mail.html);

      assert.ok(alle.length >= 1, `${name} renders no control at all, so this test proves nothing`);
      for (const { zelle, anker } of alle) {
        const umrandet = zelle.includes("border:1px solid");
        const hoehe = zahl(anker, /padding:(\d+)px/);
        const breite = zahl(anker, /padding:\d+px (\d+)px/);
        const zeile = zahl(anker, /line-height:(\d+)px/);

        assert.equal(zahl(zelle, /border-radius:(\d+)px/), 12, `${name} rounds a control off ctaButton's rounded-xl`);
        assert.ok(anker.includes("font-weight:700;"), `${name} sets a control below ctaButton's font-bold`);
        assert.ok(anker.includes("display:inline-block;"), `${name} leaves a control's padded area unclickable`);
        assert.equal(hoehe * 2 + zeile + (umrandet ? 2 : 0), 48, `${name}'s control is not ctaButton's h-12`);
        assert.equal(breite + (umrandet ? 1 : 0), 24, `${name}'s control is not ctaButton's px-6`);
      }
    }
  });

  /* `bg-brand-solid` with `shadow-md`, and `bg-transparent` with `border-border`: the outline grade
     rests on the card, so it declares no fill of its own and needs no second dark rule to follow it. */
  it("grades a pair as ctaButton grades one, filled first and outlined beside it", () => {
    const paar = knoepfe(NACHRICHTEN[0]?.mail.html ?? "");

    assert.equal(paar.length, 2, "the application messages no longer offer a pair, so this test proves nothing");
    assert.ok(paar[0]?.zelle.includes(`background-color:${constant("BRAND_SOLID_COLOR")};`), "the primary control lost its fill");
    assert.ok(paar[0]?.zelle.includes("box-shadow:"), "the primary control lost shadow-md");
    assert.ok(paar[1]?.zelle.includes(`border:1px solid ${constant("RULE_COLOR")};`), "the outline control lost its border");
    assert.ok(!paar[1]?.zelle.includes("background-color"), "the outline control declares a fill ctaButton leaves transparent");
    assert.ok(paar[1]?.anker.includes(`color:${constant("HEADING_COLOR")};`), "the outline control's label is not text-foreground");
  });

  /* `Aktion.href` and `Aktion.label` are interface fields. Today's two callers hand them module
     constants, so no rendered message reaches this guard -- and no fixture reaches it either,
     which is exactly where a third caller would lean on it. */
  it("escapes a control's own destination and label", () => {
    const karte = renderKarte({
      titel: "Anmeldung",
      ueberschrift: "Anmeldung",
      bloecke: [],
      aktionen: [
        { href: `https://frankfurtleague.de/a?b="c"&d=<e>`, label: `Frage <b>"stellen"</b>`, ton: "primary" },
        { href: `https://frankfurtleague.de/f?g='h'&i=<j>`, label: `Laufende <i>'Saison'</i>`, ton: "outline" },
      ],
      fuss: "Antworten liest niemand.",
    });

    assert.ok(karte.includes(`href="https://frankfurtleague.de/a?b=&quot;c&quot;&amp;d=&lt;e&gt;"`), "the filled control's destination is raw");
    assert.ok(karte.includes(`href="https://frankfurtleague.de/f?g=&#39;h&#39;&amp;i=&lt;j&gt;"`), "the outline control's destination is raw");
    assert.ok(karte.includes("Frage &lt;b&gt;&quot;stellen&quot;&lt;/b&gt;"), "the filled control's label is raw");
    assert.ok(karte.includes("Laufende &lt;i&gt;&#39;Saison&#39;&lt;/i&gt;"), "the outline control's label is raw");
  });

  /* Outlook has no flexbox, so a row of controls is a row of cells; the stylesheet turns them into
     blocks below the card's width, which is where a row of two stops fitting. */
  it("stacks its controls where a row will not fit", () => {
    for (const { name, mail } of NACHRICHTEN) {
      assert.ok(mail.html.includes("@media (max-width: 480px)"), `${name} has no rule to stack on a narrow screen`);
      assert.match(stylesheet(mail.html), /\.fl-actions[^}]*display: block !important/, `${name}'s stack rule does not stack`);
      for (const { zelle } of knoepfe(mail.html)) assert.ok(zelle.includes("fl-action"), `${name} has a control the stack rule cannot reach`);
    }
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
