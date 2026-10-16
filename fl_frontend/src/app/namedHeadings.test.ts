import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import {
  FINALRUNDEN_EINTRAG,
  HANDLUNGSBEDARF_EINTRAG,
  LOESCHUNG_EINTRAG,
  SPERRLISTE_EINTRAG,
  SPIELSUCHE_EINTRAG,
  SPIELTAGE_EINTRAG,
  TEAMS_EINTRAG,
  UEBERALL_ABMELDEN,
} from "@/features/admin/constants.ts";
import { ADRESSE_KORRIGIEREN } from "@/features/bewerbungen/constants.ts";
import { ORGANISATION_TITEL } from "@/features/meta/constants.ts";
import {
  REGELN_ABSCHNITT,
  SPIELPLAN_ABSCHNITT,
  SPIELPLAN_NEU_ANLEGEN,
  SPIELPLAN_ZURUECKNEHMEN,
  ZEITRAUM_ABSCHNITT,
} from "@/features/saisons/constants.ts";
import { ADRESSE_AENDERN, KADER_ABSCHNITT } from "@/features/spieler/constants.ts";
import { KONTAKTE_ABSCHNITT, SAISON_ABSCHNITT } from "@/features/teams/constants.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

const shown = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join("/");

/**
 * What a sentence sends the reader to: its words, their constant, the module defining it and each
 * module rendering them. `seite` marks a page's name, which a list of names points to as a quotation does.
 */
type Benannt = {
  readonly wort: string;
  readonly konstante: string;
  readonly heim: string;
  readonly zeigen: readonly string[];
  readonly seite?: true;
};

const SPIELER_FORM = "features/spieler/components/forms/AdminSpielerEditForm";
const TEAM_FORM = "features/teams/components/forms/AdminTeamEditForm";
const SAISON_FORM = "features/saisons/components/forms/AdminSaisonEditForm";
const ADMIN = "features/admin/constants.ts";
const ANTWORTEN = "core/adresswechselAntworten.ts";
const ADRESSWECHSEL_SEITEN = [
  "features/schiedsrichter/components/views/SchiedsrichterAdresswechselView.tsx",
  "features/spieler/components/views/SpielerAdresswechselView.tsx",
];

/** A sidemenu entry, which the shell renders as its page's heading and the menu's link: its structure is where it shows. */
const eintrag = (konstante: string, { label }: { label: string }): Benannt => ({
  wort: label,
  konstante: konstante,
  heim: ADMIN,
  zeigen: [ADMIN],
  seite: true,
});

const REGISTER: readonly Benannt[] = [
  {
    wort: KADER_ABSCHNITT,
    konstante: "KADER_ABSCHNITT",
    heim: "features/spieler/constants.ts",
    zeigen: [`${SPIELER_FORM}/FormKaderSection.tsx`, "features/spieler/spielerDraftStatus.ts"],
  },
  {
    wort: SAISON_ABSCHNITT,
    konstante: "SAISON_ABSCHNITT",
    heim: "features/teams/constants.ts",
    zeigen: [`${TEAM_FORM}/FormSaisonSection.tsx`, "features/teams/teamDraftStatus.ts"],
  },
  {
    wort: KONTAKTE_ABSCHNITT,
    konstante: "KONTAKTE_ABSCHNITT",
    heim: "features/teams/constants.ts",
    zeigen: [`${TEAM_FORM}/FormKontakteLinkSection.tsx`],
  },
  {
    wort: ZEITRAUM_ABSCHNITT,
    konstante: "ZEITRAUM_ABSCHNITT",
    heim: "features/saisons/constants.ts",
    zeigen: [`${SAISON_FORM}/FormZeitraumSection.tsx`, "features/saisons/saisonDraftStatus.ts"],
  },
  {
    wort: REGELN_ABSCHNITT,
    konstante: "REGELN_ABSCHNITT",
    heim: "features/saisons/constants.ts",
    zeigen: [`${SAISON_FORM}/FormRegelnSection.tsx`, "features/saisons/saisonDraftStatus.ts"],
  },
  {
    wort: SPIELPLAN_ABSCHNITT,
    konstante: "SPIELPLAN_ABSCHNITT",
    heim: "features/saisons/constants.ts",
    zeigen: [`${SAISON_FORM}/FormSpielplanSection.tsx`],
  },
  {
    wort: ORGANISATION_TITEL,
    konstante: "ORGANISATION_TITEL",
    heim: "features/meta/constants.ts",
    zeigen: ["features/meta/components/views/MetaOrganisationView.tsx", "app/(public)/(meta)/organisation/page.tsx"],
    seite: true,
  },
  eintrag("HANDLUNGSBEDARF_EINTRAG", HANDLUNGSBEDARF_EINTRAG),
  eintrag("TEAMS_EINTRAG", TEAMS_EINTRAG),
  eintrag("SPERRLISTE_EINTRAG", SPERRLISTE_EINTRAG),
  eintrag("LOESCHUNG_EINTRAG", LOESCHUNG_EINTRAG),
  eintrag("SPIELTAGE_EINTRAG", SPIELTAGE_EINTRAG),
  eintrag("FINALRUNDEN_EINTRAG", FINALRUNDEN_EINTRAG),
  eintrag("SPIELSUCHE_EINTRAG", SPIELSUCHE_EINTRAG),
  {
    wort: UEBERALL_ABMELDEN,
    konstante: "UEBERALL_ABMELDEN",
    heim: ADMIN,
    zeigen: ["features/funktionen/components/forms/AdminLoeschungForm/FormAbmeldenSection.tsx"],
  },
  {
    wort: ADRESSE_AENDERN,
    konstante: "ADRESSE_AENDERN",
    heim: "features/spieler/constants.ts",
    zeigen: [`${SPIELER_FORM}/FormAdresseSection.tsx`],
  },
  { wort: JA_MEINE_ADRESSE, konstante: "JA_MEINE_ADRESSE", heim: ANTWORTEN, zeigen: ADRESSWECHSEL_SEITEN },
  { wort: NICHT_MEINE_ADRESSE, konstante: "NICHT_MEINE_ADRESSE", heim: ANTWORTEN, zeigen: ADRESSWECHSEL_SEITEN },
  {
    wort: ADRESSE_KORRIGIEREN,
    konstante: "ADRESSE_KORRIGIEREN",
    heim: "features/bewerbungen/constants.ts",
    zeigen: ["features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx"],
  },
  {
    wort: SPIELPLAN_NEU_ANLEGEN,
    konstante: "SPIELPLAN_NEU_ANLEGEN",
    heim: "features/saisons/constants.ts",
    zeigen: [`${SAISON_FORM}/FormSpielplanSection.tsx`],
  },
  {
    wort: SPIELPLAN_ZURUECKNEHMEN,
    konstante: "SPIELPLAN_ZURUECKNEHMEN",
    heim: "features/saisons/constants.ts",
    zeigen: [`${SAISON_FORM}/FormSpielplanSection.tsx`],
  },
];

/** One piece of German a module writes, where it sits. */
type Fragment = { readonly text: string; readonly where: string };

/**
 * Every piece of text a module writes: a string, each run of a template between its holes, and the
 * text of its markup. A comment is no node, so it is never read.
 */
function fragmentsOf(file: string, text: string): Fragment[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Fragment[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      // Never an import's module name, which is a path rather than anything a reader sees.
      if (!(ts.isStringLiteral(node) && ts.isImportDeclaration(node.parent))) {
        found.push({ text: node.text, where: `${file}:${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** What a run holds where a value is computed rather than typed, which no word can match across. */
const HOLE = "\u0000";

const isPlus = (node: ts.Node): node is ts.BinaryExpression =>
  ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken;

/** Whether an expression contributes typed text to the sentence it stands in. */
function isText(node: ts.Node): node is ts.Expression {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return true;
  if (ts.isParenthesizedExpression(node)) return isText(node.expression);

  return isPlus(node) && (isText(node.left) || isText(node.right));
}

function textOf(node: ts.Expression): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => HOLE + span.literal.text).join("");
  if (ts.isParenthesizedExpression(node)) return textOf(node.expression);
  if (isPlus(node)) return textOf(node.left) + textOf(node.right);

  return HOLE;
}

const isMarkup = (node: ts.Node): node is ts.JsxElement | ts.JsxFragment => ts.isJsxElement(node) || ts.isJsxFragment(node);

/** An element's text as a reader meets it, through every element nested in it: a quote pair split around `<b>` is one. */
function markupTextOf(node: ts.JsxElement | ts.JsxFragment): string {
  return node.children
    .map((child) => {
      if (ts.isJsxText(child)) return child.text;
      if (isMarkup(child)) return markupTextOf(child);
      // An empty one is a comment, which renders nothing between the words beside it.
      if (ts.isJsxExpression(child)) return child.expression === undefined ? "" : isText(child.expression) ? textOf(child.expression) : HOLE;

      return HOLE;
    })
    .join("");
}

/**
 * Every sentence a module writes, whole: a string, a template with a hole for each value, a `+` chain
 * of them, and an element's text through its nested markup. A part of a larger run is read only in it.
 */
function runsOf(file: string, text: string): Fragment[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Fragment[] = [];
  const at = (node: ts.Node): string => `${file}:${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}`;
  const insideARun = (node: ts.Node): boolean =>
    ((isPlus(node.parent) || ts.isParenthesizedExpression(node.parent)) && isText(node.parent)) ||
    (ts.isJsxExpression(node.parent) && isMarkup(node.parent.parent));
  const visit = (node: ts.Node): void => {
    // A module's name is a path rather than anything a reader sees.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (isMarkup(node) && !isMarkup(node.parent)) found.push({ text: markupTextOf(node), where: at(node) });
    else if (isText(node) && !insideARun(node)) found.push({ text: textOf(node), where: at(node) });
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Every pair a quotation can stand in, the German one and each a copy edit might type instead. */
const QUOTE_PAIRS = [
  ["„", "“"],
  ["‚", "‘"],
  ["»", "«"],
  ["«", "»"],
  ["“", "”"],
  ["‘", "’"],
  ['"', '"'],
  ["'", "'"],
] as const;

const escaped = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** No letter or digit on that side, so a registered word inside a longer one is no match. */
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;

/**
 * Each place a run types a registered word: in any quotation, after a word pointing somewhere, or as a
 * page's name listed beside another's. A listed section heading is an ordinary noun, as in „mit
 * Zeitraum und Regeln“.
 */
function typedNames(words: readonly string[], pages: readonly string[]): (run: string) => { worte: string[]; wie: string }[] {
  const pointed = words.map((wort) => ({
    wort,
    pattern: new RegExp(String.raw`${START}(?:[Aa]bschnitts?|Bereichs?|[Uu]nter)\s+${escaped(wort)}${END}`, "u"),
  }));
  // Longest first, so a name opening with a shorter one is matched whole.
  const any = [...pages]
    .sort((a, b) => b.length - a.length)
    .map(escaped)
    .join("|");
  const listed = new RegExp(String.raw`${START}(${any})${END}(?:,\s+|\s+(?:und|oder|sowie)\s+)(${any})${END}`, "gu");

  return (run) => [
    ...pointed.flatMap(({ wort, pattern }) =>
      // Most runs hold no registered word at all, which the cheap test settles before either pattern runs.
      !run.includes(wort)
        ? []
        : [
            ...(QUOTE_PAIRS.some(([open, close]) => run.includes(`${open}${wort}${close}`)) ? [{ worte: [wort], wie: "quotes" }] : []),
            ...(pattern.test(run) ? [{ worte: [wort], wie: "points to" }] : []),
          ],
    ),
    ...[...run.matchAll(listed)].flatMap(([, first, second]) =>
      first !== undefined && second !== undefined && first !== second ? [{ worte: [first, second], wie: "lists" }] : [],
    ),
  ];
}

/** Whether a module reads `konstante` anywhere but at its own declaration and its import. */
function reads(file: string, text: string, konstante: string): boolean {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && node.text === konstante && !(ts.isVariableDeclaration(node.parent) && node.parent.name === node)) found = true;
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/* Production alone: a test, and the suite's own harness, write a heading's words to compare against. */
const PRODUCTION = filesUnder(SRC_DIR, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 600).filter(
  (file) => !shown(file).startsWith("shared/testing/"),
);

const read = (relative: string): string => readFileSync(path.join(SRC_DIR, relative), "utf8");

/*
 * A sweep and not a lint ban: the words are the constants' values, which no selector reads, and a
 * rendering module is one the register names. A `where` written as a literal is the lint's
 * (`fl_frontend/eslint.config.mjs`).
 */
describe("a heading or a control a sentence names", () => {
  it("reads every fragment kind a module writes its text in, and never a comment", () => {
    const sample = [
      "// „Kader“ in a comment",
      'const a = "eins";',
      "const b = `zwei ${a} drei ${a} vier`;",
      "const c = `fünf`;",
      'const d = <p title="sechs">sieben</p>;',
    ].join("\n");

    assert.deepEqual(
      fragmentsOf("sample.tsx", sample).map(({ text }) => text),
      ["eins", "zwei ", " drei ", " vier", "fünf", "sechs", "sieben"],
    );
  });

  it("reads a sentence whole, across holes, `+` chains and nested markup, and never a module's name", () => {
    const sample = [
      'import x from "modul";',
      "// „Kader“ in a comment",
      'const a = "eins";',
      "const b = `zwei ${a} drei`;",
      'const c = "vier " + a + " fünf";',
      'const d = <p title="sechs">sieben <b>acht</b>{" neun"}{a}<br />zehn{/* elf */}</p>;',
      'const e = x ? "zwölf" : <i>dreizehn</i>;',
    ].join("\n");

    assert.deepEqual(
      runsOf("sample.tsx", sample).map(({ text }) => text),
      ["eins", `zwei ${HOLE} drei`, `vier ${HOLE} fünf`, `sieben acht neun${HOLE}${HOLE}zehn`, "sechs", "zwölf", "dreizehn"],
    );
  });

  it("finds a registered word in any quotation, after a pointing word, or listed, and never inside a longer word", () => {
    const pages = ["Teams", "Spielsuche"];
    const words = ["Kader", "Saison", "Spielplan neu anlegen", ...pages];
    const finder = typedNames(words, pages);
    const named = (run: string): string[] => finder(run).map(({ worte, wie }) => `${wie} ${worte.join(" ")}`);

    for (const [run, expected] of [
      ["Öffne „Kader“.", ["quotes Kader"]],
      ["Öffne ‚Kader‘, »Saison« oder “Kader”.", ["quotes Kader", "quotes Saison"]],
      ['Öffne "Kader".', ["quotes Kader"]],
      ["Trage es im Abschnitt Kader ein.", ["points to Kader"]],
      ["Unter Saison steht es.", ["points to Saison"]],
      ["Drücke unter Spielplan neu anlegen.", ["points to Spielplan neu anlegen"]],
      ["damit Teams, Spielsuche und Spielplan etwas zeigen", ["lists Teams Spielsuche"]],
      ["Der Kader steht. „Kaderliste“, unter Kaderleitung, darunter Kader, mit Kader und Saison, Teams und Teams.", []],
    ] as const) {
      assert.deepEqual(named(run), expected, run);
    }
  });

  it("is named in no sentence by words typed there", () => {
    const konstanten = new Map<string, string[]>();
    for (const { wort, konstante } of REGISTER) konstanten.set(wort, [...(konstanten.get(wort) ?? []), konstante]);
    const words = [...konstanten.keys()];
    const finder = typedNames(
      words,
      REGISTER.filter(({ seite }) => seite === true).map(({ wort }) => wort),
    );

    const typed = PRODUCTION.flatMap((file) =>
      runsOf(shown(file), readFileSync(file, "utf8")).flatMap(({ text, where }) =>
        finder(text).map(
          ({ worte, wie }) =>
            `${where} ${wie} ${worte.map((wort) => `„${wort}“`).join(" and ")} rather than reading ${worte.flatMap((wort) => konstanten.get(wort) ?? []).join(" or ")}`,
        ),
      ),
    );

    assert.deepEqual(typed, []);
  });

  it("is rendered from its constant wherever it shows, and typed only where the constant is defined", () => {
    const astray = REGISTER.flatMap(({ wort, konstante, heim, zeigen }) =>
      [...new Set([heim, ...zeigen])].flatMap((modul) => {
        const text = read(modul);
        const typed = fragmentsOf(modul, text)
          .filter((fragment) => fragment.text.trim() === wort)
          .map(({ where }) => where);
        const allowed = modul === heim ? 1 : 0;
        return [
          ...(typed.length === allowed
            ? []
            : typed.length === 0
              ? [`${modul} no longer defines ${konstante} as „${wort}“`]
              : [`${typed.join(", ")} ${typed.length === 1 ? "types" : "type"} „${wort}“, which only ${konstante}'s definition may`]),
          ...(zeigen.includes(modul) && !reads(modul, text, konstante) ? [`${modul} renders „${wort}“ without reading ${konstante}`] : []),
        ];
      }),
    );

    assert.deepEqual(astray, []);
  });
});
