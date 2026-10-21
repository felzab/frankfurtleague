import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { ADRESSWECHSEL_STOPPEN, JA_ANGEFRAGT, NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten.ts";
import {
  ABOUT_TITEL,
  ADMINISTRATOREN_TITEL,
  DATENSCHUTZ_TITEL,
  DEIN_BEREICH_TITEL,
  EINSAETZE_TITEL,
  IMPRESSUM_TITEL,
  KONTAKT_TITEL,
  OFFENE_ANTRAEGE,
  ORGANISATION_TITEL,
  SAISONUEBERSICHT_TITEL,
  VERWALTUNG_TITEL,
} from "@/core/seitenNamen.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import {
  ADRESSWECHSEL_EINTRAG,
  FINALRUNDEN_EINTRAG,
  HANDLUNGSBEDARF_EINTRAG,
  LOESCHUNG_EINTRAG,
  SAISONS_EINTRAG,
  SPERRLISTE_EINTRAG,
  SPIELSUCHE_EINTRAG,
  SPIELTAGE_EINTRAG,
  TEAMS_EINTRAG,
  UEBERALL_ABMELDEN,
} from "@/features/admin/constants.ts";
import { ADRESSE_KORRIGIEREN } from "@/features/bewerbungen/constants.ts";
import {
  REGELN_ABSCHNITT,
  SPIELPLAN_ABSCHNITT,
  SPIELPLAN_NEU_ANLEGEN,
  SPIELPLAN_ZURUECKNEHMEN,
  ZEITRAUM_ABSCHNITT,
} from "@/features/saisons/constants.ts";
import { SCHIEDSRICHTER_ANONYM_LABEL } from "@/features/schiedsrichter/constants.ts";
import { KADER_ABSCHNITT, SPIELER_ANONYM_LABEL } from "@/features/spieler/constants.ts";
import { KONTAKTE_ABSCHNITT, SAISON_ABSCHNITT } from "@/features/teams/constants.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

const shown = (file: string): string => path.relative(SRC_DIR, file).split(path.sep).join("/");

/**
 * What a sentence names, a place or a value's word: its words, their constant, the module defining it and each
 * module rendering them.
 */
type Benannt = {
  readonly wort: string;
  readonly konstante: string;
  readonly heim: string;
  readonly zeigen: readonly string[];
  /** The address of the page this names, which a list of names points to as a quotation does, and whose links read the name. */
  readonly seite?: string;
  /** A control's label, which a sentence opening on it names as much as one quoting it. */
  readonly steuerung?: true;
  /** The name's declined forms, which no constant can hold: a sentence quotes the name instead. */
  readonly gebeugt?: RegExp;
};

const SPIELER_FORM = "features/spieler/components/forms/AdminSpielerEditForm";
const TEAM_FORM = "features/teams/components/forms/AdminTeamEditForm";
const SAISON_FORM = "features/saisons/components/forms/AdminSaisonEditForm";
const SAISONS_TABELLE = "features/saisons/components/collections/AdminSaisonsTable.tsx";
const ADMIN = "features/admin/constants.ts";
const ANTWORTEN = "core/adresswechselAntworten.ts";
const ADRESSWECHSEL_SEITEN = ["features/adresswechsel/components/views/AdresswechselLinkView.tsx"];

const TOP_NAV = "shared/components/layout/topnav/TopNav.tsx";
const FOOTER = "shared/components/layout/footer/Footer.tsx";
const META_PAGES = "app/(public)/(meta)";
const META_VIEWS = "features/meta/components/views";
const BEWERBUNG_SEITE = "features/bewerbungen/components/views/BewerbungView.tsx";

/** A page the top bar or the footer links to, by the name every link, title and heading reads. */
const seitenName = (konstante: string, wort: string, seite: string, zeigen: readonly string[], gebeugt?: RegExp): Benannt => ({
  wort: wort,
  konstante: konstante,
  heim: "core/seitenNamen.ts",
  zeigen: zeigen,
  seite: seite,
  ...(gebeugt === undefined ? {} : { gebeugt: gebeugt }),
});

/** A sidemenu entry, which the shell renders as its page's heading and the menu's link: its structure is where it shows. */
const eintrag = (konstante: string, { id, label }: { id: string; label: string }, zeigen: readonly string[] = []): Benannt => ({
  wort: label,
  konstante: konstante,
  heim: ADMIN,
  zeigen: [ADMIN, ...zeigen],
  seite: `/bereich/admin/${id}`,
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
    wort: EINSAETZE_TITEL,
    konstante: "EINSAETZE_TITEL",
    heim: "core/seitenNamen.ts",
    zeigen: [
      "features/spielbestaetigungen/components/views/SchiedsrichterEinsaetzeSection.tsx",
      "core/spielEmail.ts",
      "features/funktionen/utils.ts",
    ],
  },
  seitenName("SAISONUEBERSICHT_TITEL", SAISONUEBERSICHT_TITEL, "/dashboard", [
    TOP_NAV,
    "app/dashboard/layout.tsx",
    "features/dashboard/constants.ts",
    "app/dashboard/not-found.tsx",
  ]),
  seitenName(
    "DEIN_BEREICH_TITEL",
    DEIN_BEREICH_TITEL,
    "/bereich",
    [
      TOP_NAV,
      "shared/components/layout/sidemenu/FunktionSwitcher.tsx",
      "features/funktionen/constants.ts",
      "features/funktionen/components/ui/TeamForbiddenPanel.tsx",
      `${META_VIEWS}/DatenschutzView.tsx`,
      "core/kontaktEmail.ts",
      "core/spielEmail.ts",
      "features/auth/components/ui/SignedInCard.tsx",
      "app/bereich/(persoenlich)/not-found.tsx",
    ],
    /(?<![\p{L}\p{N}])[Dd]ein(?:em|en|es)\s+Bereich(?:e?s)?(?![\p{L}\p{N}])/u,
  ),
  seitenName("VERWALTUNG_TITEL", VERWALTUNG_TITEL, "/bereich/admin", [
    ADMIN,
    "features/funktionen/utils.ts",
    "app/bereich/admin/not-found.tsx",
  ]),
  // Named by the mails sending an approver there, which `core` holds and no feature constant can reach.
  seitenName("ADMINISTRATOREN_TITEL", ADMINISTRATOREN_TITEL, "/bereich/admin/administratoren", [ADMIN, "core/adresswechselEmail.ts"]),
  {
    wort: OFFENE_ANTRAEGE,
    konstante: "OFFENE_ANTRAEGE",
    heim: "core/seitenNamen.ts",
    zeigen: [
      "features/berechtigungen/components/collections/AdminBerechtigungAntraegeList.tsx",
      "features/berechtigungen/constants.ts",
      "core/berechtigungEmail.ts",
    ],
  },
  seitenName("ABOUT_TITEL", ABOUT_TITEL, "/about", [
    TOP_NAV,
    FOOTER,
    `${META_PAGES}/about/page.tsx`,
    `${META_VIEWS}/AboutView.tsx`,
    BEWERBUNG_SEITE,
  ]),
  seitenName("ORGANISATION_TITEL", ORGANISATION_TITEL, "/organisation", [
    TOP_NAV,
    FOOTER,
    `${META_PAGES}/organisation/page.tsx`,
    `${META_VIEWS}/MetaOrganisationView.tsx`,
    `${META_VIEWS}/DatenschutzView.tsx`,
    "features/meta/constants.ts",
  ]),
  seitenName("KONTAKT_TITEL", KONTAKT_TITEL, "/kontakt", [
    TOP_NAV,
    FOOTER,
    `${META_PAGES}/kontakt/page.tsx`,
    `${META_VIEWS}/KontaktView.tsx`,
    BEWERBUNG_SEITE,
    "app/(public)/page.tsx",
    "features/meta/constants.ts",
  ]),
  seitenName("IMPRESSUM_TITEL", IMPRESSUM_TITEL, "/impressum", [
    FOOTER,
    `${META_PAGES}/impressum/page.tsx`,
    `${META_VIEWS}/ImpressumView.tsx`,
    "core/emailShell.ts",
    `${META_VIEWS}/DatenschutzView.tsx`,
  ]),
  seitenName("DATENSCHUTZ_TITEL", DATENSCHUTZ_TITEL, "/datenschutz", [FOOTER, `${META_PAGES}/datenschutz/page.tsx`]),
  eintrag("HANDLUNGSBEDARF_EINTRAG", HANDLUNGSBEDARF_EINTRAG),
  eintrag("TEAMS_EINTRAG", TEAMS_EINTRAG, [SAISONS_TABELLE]),
  eintrag("SPERRLISTE_EINTRAG", SPERRLISTE_EINTRAG),
  eintrag("LOESCHUNG_EINTRAG", LOESCHUNG_EINTRAG),
  eintrag("ADRESSWECHSEL_EINTRAG", ADRESSWECHSEL_EINTRAG, ["features/adresswechsel/components/ui/AdresswechselHinweis.tsx"]),
  eintrag("SAISONS_EINTRAG", SAISONS_EINTRAG),
  eintrag("SPIELTAGE_EINTRAG", SPIELTAGE_EINTRAG, [SAISONS_TABELLE]),
  eintrag("FINALRUNDEN_EINTRAG", FINALRUNDEN_EINTRAG),
  eintrag("SPIELSUCHE_EINTRAG", SPIELSUCHE_EINTRAG),
  {
    wort: UEBERALL_ABMELDEN,
    konstante: "UEBERALL_ABMELDEN",
    heim: ADMIN,
    zeigen: ["features/funktionen/components/forms/AdminLoeschungForm/FormAbmeldenSection.tsx"],
    steuerung: true,
  },
  { wort: JA_ANGEFRAGT, konstante: "JA_ANGEFRAGT", heim: ANTWORTEN, zeigen: ADRESSWECHSEL_SEITEN, steuerung: true },
  { wort: NICHT_MEINE_ADRESSE, konstante: "NICHT_MEINE_ADRESSE", heim: ANTWORTEN, zeigen: ADRESSWECHSEL_SEITEN, steuerung: true },
  // Named by the notice to the address on file, so offered under that word on the stop link's page and the account page.
  {
    wort: ADRESSWECHSEL_STOPPEN,
    konstante: "ADRESSWECHSEL_STOPPEN",
    heim: ANTWORTEN,
    zeigen: [...ADRESSWECHSEL_SEITEN, "features/konto/components/forms/AdresswechselForm/AdresswechselPanel.tsx"],
    steuerung: true,
  },
  {
    wort: ADRESSE_KORRIGIEREN,
    konstante: "ADRESSE_KORRIGIEREN",
    heim: "features/bewerbungen/constants.ts",
    zeigen: ["features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx"],
    steuerung: true,
  },
  {
    wort: SPIELPLAN_NEU_ANLEGEN,
    konstante: "SPIELPLAN_NEU_ANLEGEN",
    heim: "features/saisons/constants.ts",
    zeigen: [`${SAISON_FORM}/FormSpielplanSection.tsx`, `${SAISON_FORM}/blockedReasons.ts`],
    steuerung: true,
  },
  {
    wort: SPIELPLAN_ZURUECKNEHMEN,
    konstante: "SPIELPLAN_ZURUECKNEHMEN",
    heim: "features/saisons/constants.ts",
    zeigen: [`${SAISON_FORM}/FormSpielplanSection.tsx`, `${SAISON_FORM}/blockedReasons.ts`, "features/saisons/utils.ts"],
    steuerung: true,
  },
  // A value's word in a name's place, which a sentence telling the reader what a page will show quotes.
  {
    wort: SPIELER_ANONYM_LABEL,
    konstante: "SPIELER_ANONYM_LABEL",
    heim: "features/spieler/constants.ts",
    zeigen: ["features/meta/components/views/DatenschutzView.tsx"],
  },
  {
    wort: SCHIEDSRICHTER_ANONYM_LABEL,
    konstante: "SCHIEDSRICHTER_ANONYM_LABEL",
    heim: "features/schiedsrichter/constants.ts",
    zeigen: [
      "features/meta/components/views/DatenschutzView.tsx",
      "features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx",
    ],
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

/** Any of `names`, longest first, so a name opening with a shorter one is matched whole. */
const anyOf = (names: readonly string[]): string =>
  [...names]
    .sort((a, b) => b.length - a.length)
    .map(escaped)
    .join("|");

/**
 * Each place a run types a registered word. A section heading listed or opening a sentence is an
 * ordinary noun, as in „mit Zeitraum und Regeln“: only a page's name is read listed, a control's
 * label opening one.
 */
function typedNames({
  words,
  pages,
  controls,
  declined,
}: {
  words: readonly string[];
  pages: readonly string[];
  controls: readonly string[];
  declined: ReadonlyMap<string, RegExp>;
}): (run: string) => { worte: string[]; wie: string }[] {
  const finders = words.map((wort) => ({
    wort,
    pointed: new RegExp(
      String.raw`${START}(?:(?:[Aa]bschnitts?|Bereichs?|[Uu]nter)\s+${escaped(wort)}${pages.includes(wort) ? String.raw`|${escaped(wort)}-Seite` : ""})${END}`,
      "u",
    ),
    // Words after the label, so the label alone, as its control or its constant spells it, is no sentence.
    opens: controls.includes(wort) ? new RegExp(String.raw`(?:^\s*|[.!?]\s+)${escaped(wort)}(?=\s+\S)`, "u") : null,
    gebeugt: declined.get(wort) ?? null,
  }));
  const listed = new RegExp(String.raw`${START}(${anyOf(pages)})${END}(?:,\s+|\s+(?:und|oder|sowie)\s+)(${anyOf(pages)})${END}`, "gu");

  return (run) => [
    ...finders.flatMap(({ wort, pointed, opens, gebeugt }) => [
      // Never the word itself, so read before the cheap test below.
      ...(gebeugt?.test(run) === true ? [{ worte: [wort], wie: "declines" }] : []),
      // Most runs hold no registered word at all, which the cheap test settles before the patterns run.
      ...(!run.includes(wort)
        ? []
        : [
            ...(QUOTE_PAIRS.some(([open, close]) => run.includes(`${open}${wort}${close}`)) ? [{ worte: [wort], wie: "quotes" }] : []),
            ...(pointed.test(run) ? [{ worte: [wort], wie: "points to" }] : []),
            ...(opens?.test(run) === true ? [{ worte: [wort], wie: "opens on" }] : []),
          ]),
    ]),
    ...[...run.matchAll(listed)].flatMap(([, first, second]) =>
      first !== undefined && second !== undefined && first !== second ? [{ worte: [first, second], wie: "lists" }] : [],
    ),
  ];
}

const isNamed = (attribute: ts.JsxAttributeLike, names: ReadonlySet<string>): attribute is ts.JsxAttribute =>
  ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && names.has(attribute.name.text);

const keyOf = (property: ts.ObjectLiteralElementLike): string | null =>
  property.name !== undefined && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null;

const HREF = new Set(["href"]);
const LINK_LABELS = new Set(["label", "linkLabel"]);

/**
 * The page an `href` names as typed: its path before any query or fragment, `null` where a value computes it. A leading
 * hole before a typed path is a message's origin.
 */
function zielOf(value: ts.Node | undefined): string | null {
  if (value === undefined) return null;
  if (ts.isJsxExpression(value)) return zielOf(value.expression);
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text.replace(/[?#].*$/su, "") || null;
  if (!ts.isTemplateExpression(value)) return null;

  const [erste, ...weitere] = value.templateSpans;
  const nachOrigin = value.head.text === "" && erste?.literal.text.startsWith("/") === true;
  const typed = nachOrigin ? (erste?.literal.text ?? "") : value.head.text;
  // A hole the path runs into before its query computes the page: `${base}/${id}` leads under `base`, never to `/`.
  const offen = nachOrigin ? weitere.length > 0 : true;
  if (offen && !/[?#]/u.test(typed)) return null;

  return typed.replace(/[?#].*$/su, "") || null;
}

/** One text a module gives a link, beside the page that link leads to. */
type Verweis = Fragment & { readonly ziel: string | null };

/**
 * Every text a module gives a link, whatever renders it: the markup of an element carrying an `href`, and the
 * `label` or `linkLabel` handed beside one, as a prop or in an object.
 */
function linkTextsOf(file: string, text: string): Verweis[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: Verweis[] = [];
  const at = (node: ts.Node): string => `${file}:${String(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1)}`;
  const visit = (node: ts.Node): void => {
    const element = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    const href = element?.attributes.properties.find((attribute) => isNamed(attribute, HREF));
    if (element !== null && href !== undefined && isNamed(href, HREF)) {
      const ziel = zielOf(href.initializer);
      if (ts.isJsxElement(node)) found.push({ text: markupTextOf(node), where: at(node), ziel: ziel });
      for (const attribute of element.attributes.properties) {
        if (!isNamed(attribute, LINK_LABELS) || attribute.initializer === undefined) continue;
        const value = ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : attribute.initializer;
        if (value !== undefined && isText(value)) found.push({ text: textOf(value), where: at(attribute), ziel: ziel });
      }
    }
    const ziel = ts.isObjectLiteralExpression(node) ? node.properties.find((property) => keyOf(property) === "href") : undefined;
    if (ts.isObjectLiteralExpression(node) && ziel !== undefined) {
      for (const property of node.properties) {
        const key = keyOf(property);
        if (ts.isPropertyAssignment(property) && key !== null && LINK_LABELS.has(key) && isText(property.initializer)) {
          found.push({
            text: textOf(property.initializer),
            where: at(property),
            ziel: ts.isPropertyAssignment(ziel) ? zielOf(ziel.initializer) : null,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
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
describe("a heading, a control or a value's word a sentence names", () => {
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

  it("finds a registered word quoted, pointed to, listed, opening a sentence or declined, and never inside a longer word", () => {
    const pages = ["Teams", "Spielsuche", "Dein Bereich"];
    const finder = typedNames({
      words: ["Kader", "Saison", "Spielplan neu anlegen", "Neu anlegen", ...pages],
      pages: pages,
      controls: ["Neu anlegen"],
      declined: new Map([["Dein Bereich", /(?<![\p{L}\p{N}])[Dd]ein(?:em|en|es)\s+Bereich(?:e?s)?(?![\p{L}\p{N}])/u]]),
    });
    const named = (run: string): string[] => finder(run).map(({ worte, wie }) => `${wie} ${worte.join(" ")}`);

    for (const [run, expected] of [
      ["Öffne „Kader“.", ["quotes Kader"]],
      ["Öffne ‚Kader‘, »Saison« oder “Kader”.", ["quotes Kader", "quotes Saison"]],
      ['Öffne "Kader".', ["quotes Kader"]],
      ["Trage es im Abschnitt Kader ein.", ["points to Kader"]],
      ["Unter Saison steht es.", ["points to Saison"]],
      ["Drücke unter Spielplan neu anlegen.", ["points to Spielplan neu anlegen"]],
      ["damit Teams, Spielsuche und Spielplan etwas zeigen", ["lists Teams Spielsuche"]],
      ["Schreib uns über die Spielsuche-Seite.", ["points to Spielsuche"]],
      ["\n  Neu anlegen löscht den Spielplan.", ["opens on Neu anlegen"]],
      [`In ${HOLE} steht etwas. Neu anlegen lässt er sich nicht.`, ["opens on Neu anlegen"]],
      ["Weiter zu Deinem Bereich", ["declines Dein Bereich"]],
      ["Die Seiten Deines Bereichs und Deinen Bereich", ["declines Dein Bereich"]],
      ["Der Kader steht. „Kaderliste“, unter Kaderleitung, darunter Kader, mit Kader und Saison, Teams und Teams.", []],
      // A label alone is its control, and a page's name or a heading opening a sentence is an ordinary noun.
      ["Neu anlegen", []],
      ["Wähle Neu anlegen oder Spielsuche-Ergebnis.", []],
      ["Teams stehen fest. Kader und Saison auch. Dein Bereich zeigt sie.", []],
    ] as const) {
      assert.deepEqual(named(run), expected, run);
    }
  });

  it("finds every text a module gives a link, beside the page its typed address leads to, and no label without one", () => {
    const sample = [
      'const a = <Link href="/kontakt">Zum <b>Kontakt</b></Link>;',
      'const b = <ShellNotFound href="/dashboard" linkLabel="Zur Saisonübersicht" />;',
      'const c = <Link href={x} label={"Weiter"}>{y}</Link>;',
      "const d = { href: `/bereich/admin/teams?saison_id=${s}`, label: `Zum ${z}` };",
      'const e = { id: "kontakt", label: "Kontakt" };',
      'const f = <TextField label="Kontakt" />;',
      "const g = { href: x, label: KONTAKT_TITEL };",
      'const h = <Link href={"/dashboard/teams#top"}>Alle Teams</Link>;',
      // A message's link, its origin a hole ahead of the path.
      'const i = { href: `${site}/bereich?ziel=${z}`, label: "Dein Bereich" };',
      "const j = { href: `${site}${pfad}`, label: `Weiter` };",
      // A path a hole completes, after an origin or after none: the page it leads to is the value's.
      "const k = { href: `${kaderHref}/${id}`, label: `Kader` };",
      "const l = { href: `/spiele/${id}`, label: `Spiel` };",
      "const m = { href: `${site}/bereich`, label: `Dein Bereich` };",
    ].join("\n");

    assert.deepEqual(
      linkTextsOf("sample.tsx", sample).map(({ text, ziel }) => [text, ziel]),
      [
        ["Zum Kontakt", "/kontakt"],
        ["Zur Saisonübersicht", "/dashboard"],
        [HOLE, null],
        ["Weiter", null],
        [`Zum ${HOLE}`, "/bereich/admin/teams"],
        ["Alle Teams", "/dashboard/teams"],
        ["Dein Bereich", "/bereich"],
        ["Weiter", null],
        ["Kader", null],
        ["Spiel", null],
        ["Dein Bereich", "/bereich"],
      ],
    );
  });

  it("is named in no sentence by words typed there", () => {
    const konstanten = new Map<string, string[]>();
    for (const { wort, konstante } of REGISTER) konstanten.set(wort, [...(konstanten.get(wort) ?? []), konstante]);
    const finder = typedNames({
      words: [...konstanten.keys()],
      pages: REGISTER.flatMap(({ wort, seite }) => (seite === undefined ? [] : [wort])),
      controls: REGISTER.filter(({ steuerung }) => steuerung === true).map(({ wort }) => wort),
      declined: new Map(REGISTER.flatMap(({ wort, gebeugt }) => (gebeugt === undefined ? [] : [[wort, gebeugt] as const]))),
    });

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

  /* By the address: a link elsewhere, „Alle Teams“, merely shares a word. The label is the page's name itself, which a
     declined or article-bound copy cannot follow through a rename. */
  it("is typed in no link's text, where the link leads to the page it names", () => {
    const typed = PRODUCTION.flatMap((file) =>
      linkTextsOf(shown(file), readFileSync(file, "utf8")).flatMap(({ text, where, ziel }) =>
        REGISTER.filter(
          ({ wort, seite }) => seite !== undefined && seite === ziel && new RegExp(`${START}${escaped(wort)}${END}`, "u").test(text),
        ).map(({ wort, konstante }) => `${where} links by „${wort}“ rather than reading ${konstante}`),
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
