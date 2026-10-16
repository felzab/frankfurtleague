import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { HANDLUNGSBEDARF_EINTRAG, LOESCHUNG_EINTRAG, SPERRLISTE_EINTRAG, TEAMS_EINTRAG } from "@/features/admin/constants.ts";
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
 * A heading or a control a sentence sends the reader to: its words, the constant holding them, the
 * module defining that constant, and every module rendering the words.
 */
type Benannt = { readonly wort: string; readonly konstante: string; readonly heim: string; readonly zeigen: readonly string[] };

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
  },
  eintrag("HANDLUNGSBEDARF_EINTRAG", HANDLUNGSBEDARF_EINTRAG),
  eintrag("TEAMS_EINTRAG", TEAMS_EINTRAG),
  eintrag("SPERRLISTE_EINTRAG", SPERRLISTE_EINTRAG),
  eintrag("LOESCHUNG_EINTRAG", LOESCHUNG_EINTRAG),
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

  it("is quoted in no sentence by words typed there", () => {
    const quoted = PRODUCTION.flatMap((file) => {
      const fragments = fragmentsOf(shown(file), readFileSync(file, "utf8"));
      return REGISTER.flatMap(({ wort, konstante }) =>
        fragments.filter(({ text }) => text.includes(`„${wort}“`)).map(({ where }) => `${where} quotes „${wort}“ rather than ${konstante}`),
      );
    });

    assert.deepEqual(quoted, []);
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
