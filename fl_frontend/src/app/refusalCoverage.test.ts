import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { isRefusalCode } from "@/core/errors.ts";
import { keyTierOf } from "@/core/keyTiers.ts";
import { publishedOperations } from "@/core/openapiDocument.ts";
import { serverActionModules } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

import type { FLBewerbungEinwilligungAnsichtResponse } from "@/features/bewerbungen/schemas.ts";

/* The request the public mappers' reads and the undo actions load in, doubled before the `await import`s below. */
doubleActionRequest();

const { answerSettled, publishedRefusals } = await import("@/shared/testing/publishedRefusals.ts");
const { isFunktionLost } = await import("@/shared/utils/actionError.ts");
const { replayRefusal } = await import("@/shared/utils/adminUndo.ts");
const berechtigungen = await import("@/features/berechtigungen/refusals.ts");
const bewerbungen = await import("@/features/bewerbungen/refusals.ts");
const { BEWERBUNG_MIN_ALTER } = await import("@/features/bewerbungen/constants.ts");
const bewerbungUtils = await import("@/features/bewerbungen/utils.ts");
const einladungen = await import("@/features/einladungen/refusals.ts");
const funktionen = await import("@/features/funktionen/refusals.ts");
const kontoLoeschung = await import("@/features/konto/refusals.ts");
const kontakte = await import("@/features/kontakte/refusals.ts");
const konto = await import("@/features/konto/einwilligung.ts");
const registrierungen = await import("@/features/registrierungen/utils.ts");
const { MEDIEN_MIN_ALTER, REGISTRIERUNG_MIN_ALTER } = await import("@/features/registrierungen/constants.ts");
const saisons = await import("@/features/saisons/refusals.ts");
const schiedsrichter = await import("@/features/schiedsrichter/refusals.ts");
const schiedsrichterQueries = await import("@/features/schiedsrichter/queries.ts");
const sperrliste = await import("@/features/sperrliste/refusals.ts");
const spiele = await import("@/features/spiele/refusals.ts");
const spielbestaetigungen = await import("@/features/spielbestaetigungen/utils.ts");
const spieler = await import("@/features/spieler/refusals.ts");
const spielerQueries = await import("@/features/spieler/queries.ts");
const spielorte = await import("@/features/spielorte/refusals.ts");
const spieltage = await import("@/features/spieltage/refusals.ts");
const teams = await import("@/features/teams/refusals.ts");

type Mapper = (error: unknown) => unknown;

/**
 * The operation's refusals go to the shared reader alone, which words the unique index's and a lost
 * seat's among the few codes its own arms name.
 */
const SHARED_READER: Mapper = () => null;

/**
 * A team page's read refused for a seat the reader does not hold: its refusal reaches no action, the
 * page rendering the forbidden panel by the one predicate the shared reader words it by for a write.
 */
const TEAM_FORBIDDEN_PANEL: Mapper = (error) => (isFunktionLost(error) ? "the forbidden panel, in the page's stead" : null);

/**
 * The mapper each write consults for an operation's refusals, a read's context fixed where the mapper
 * takes one. That the write does consult it is its slice suite's to hold
 * (`fl_frontend/src/shared/testing/publishedRefusals.ts :: assertEachAnswered`).
 */
const ANSWERED_BY: Readonly<Record<string, Mapper>> = {
  "POST /berechtigungen": berechtigungen.mapErteilenRefusal,
  "DELETE /berechtigungen/{berechtigung_id}": berechtigungen.mapEntziehenRefusal,
  "PATCH /berechtigungen/{berechtigung_id}": berechtigungen.mapStufeRefusal,
  "POST /bewerbungen": bewerbungUtils.mapBewerbungSubmitRefusal,
  "POST /bewerbungen/einwilligung": (error) =>
    bewerbungUtils.mapEinwilligungRefusal(error, async () => ({
      zustand: "gueltig" as const,
      // The floors the link's read serves, as the contact page takes them.
      ansicht: {
        acknowledged: 1 as const,
        zustand: "gueltig" as const,
        quelle: "bewerbung" as const,
        zeile: null,
        saison_id: "2026",
        schule: "Lessing-Kolleg",
        rolle: "ansprechperson" as const,
        zugleich_rolle: null,
        laufende_fassung: "bestaetigung_kontakt",
        mindestalter: BEWERBUNG_MIN_ALTER,
        medien_mindestalter: MEDIEN_MIN_ALTER,
      } satisfies FLBewerbungEinwilligungAnsichtResponse,
    })),
  "POST /bewerbungen/einwilligung/ansicht": bewerbungUtils.mapEinwilligungAnsichtRefusal,
  "POST /bewerbungen/{bewerbung_id}/annehmen": (error) => bewerbungen.mapTriageRefusal(error, "neue_schule"),
  "POST /bewerbungen/{bewerbung_id}/ablehnen": (error) => bewerbungen.mapTriageRefusal(error, null),
  "POST /bewerbungen/{bewerbung_id}/einwilligung/{seat}/erneut": bewerbungen.mapEinwilligungErneutRefusal,
  "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}/email": bewerbungen.mapKontaktEmailRefusal,
  "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}": bewerbungen.mapKontaktSitzRefusal,
  "POST /teams/{team_id}/saisons/{saison_id}/einladung": einladungen.mapEinladungRefusal,
  "POST /saisons/{saison_id}/einladungen/versand": einladungen.mapEinladungRefusal,
  "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte": kontakte.mapKontakteRefusal,
  "POST /teams/{team_id}/saisons/{saison_id}/kontakte/{seat}/bestaetigung/einladen": kontakte.mapEinladenRefusal,
  "POST /registrierungen": registrierungen.mapRegistrierungSubmitRefusal,
  "POST /registrierungen/bestaetigung": (error) =>
    registrierungen.mapBestaetigungRefusal(error, { geburtsdatum: "2010-05-01" }, async () => ({
      zustand: "gueltig" as const,
      ansicht: { mindestalter: REGISTRIERUNG_MIN_ALTER, medien_mindestalter: MEDIEN_MIN_ALTER },
    })),
  "POST /registrierungen/einladung/ansicht": registrierungen.mapRegistrierungAnsichtRefusal,
  "POST /registrierungen/bestaetigung/ansicht": registrierungen.mapRegistrierungAnsichtRefusal,
  "GET /registrierungen/kader/{team_id}/{saison_id}": TEAM_FORBIDDEN_PANEL,
  "POST /registrierungen/{registrierung_id}/aufnehmen": registrierungen.mapAufnahmeRefusal,
  "POST /registrierungen/{registrierung_id}/ablehnen": registrierungen.mapAblehnungRefusal,
  "POST /saisons": (error) => saisons.mapRulesRefusal(error) ?? saisons.mapSaisonIdRefusal(error),
  "PATCH /saisons/{saison_id}": saisons.mapRulesRefusal,
  "POST /saisons/{saison_id}/activate": saisons.mapActivateRefusal,
  "POST /saisons/{saison_id}/gruppen/swap": saisons.mapSwapRefusal,
  "POST /saisons/{saison_id}/spielplan": (error) => saisons.mapSpielplanRefusal(error, false),
  "DELETE /saisons/{saison_id}/spielplan": saisons.mapUndrawRefusal,
  "POST /schiedsrichter": (error) => schiedsrichter.mapNameRefusal(error) ?? schiedsrichter.mapGesperrteAdresseRefusal(error),
  "PATCH /schiedsrichter/{schiedsrichter_id}": (error) =>
    schiedsrichter.mapNameRefusal(error) ?? schiedsrichter.mapGesperrteAdresseRefusal(error),
  "DELETE /schiedsrichter/{schiedsrichter_id}": schiedsrichter.mapRetireRefusal,
  "POST /schiedsrichter/{schiedsrichter_id}/reactivate": schiedsrichter.mapReactivateRefusal,
  "POST /schiedsrichter/{schiedsrichter_id}/bestaetigung/einladen": schiedsrichter.mapEinladenRefusal,
  "POST /schiedsrichter/bestaetigung": (error) =>
    schiedsrichterQueries.mapSchiedsrichterBestaetigungRefusal(error, async () => ({
      zustand: "gueltig" as const,
      // The floor the link's read serves, as the referee page takes it.
      ansicht: { mindestalter: 16, medien_mindestalter: MEDIEN_MIN_ALTER },
    })),
  "POST /schiedsrichter/bestaetigung/ansicht": schiedsrichterQueries.mapSchiedsrichterAnsichtRefusal,
  "POST /schiedsrichter/{schiedsrichter_id}/adresswechsel/einladen": schiedsrichter.mapAdresswechselRefusal,
  "POST /schiedsrichter/adresswechsel": schiedsrichterQueries.mapSchiedsrichterAdresswechselRefusal,
  "POST /schiedsrichter/adresswechsel/ansicht": schiedsrichterQueries.mapSchiedsrichterAnsichtRefusal,
  // The last owner's refusal is the slice's; the unique index's, which no request reaches without a hand
  // edit racing it, the shared reader's.
  "POST /identitaet/selbst/erasure": kontoLoeschung.mapLoeschungRefusal,
  // The operator's own address and a grant holder's are the slice's; the unique index's is the shared reader's.
  "POST /identitaet/erasure/ansicht": funktionen.mapErasureRefusal,
  "POST /identitaet/erasure": funktionen.mapErasureRefusal,
  "POST /identitaet/abmeldung": funktionen.mapAbmeldungRefusal,
  "POST /sperrliste": sperrliste.mapSperreRefusal,
  "PATCH /spiele/{spiel_id}": spiele.mapSpielRefusal,
  "POST /spielbestaetigungen": spielbestaetigungen.mapAnsetzungRefusal,
  "POST /spielbestaetigungen/ansicht": spielbestaetigungen.mapAnsetzungAnsichtRefusal,
  "POST /spielbestaetigungen/{spielbestaetigung_id}/eintragen": spielbestaetigungen.mapSpielbestaetigungAdminRefusal,
  "POST /spielbestaetigungen/{spielbestaetigung_id}/verwerfen": spielbestaetigungen.mapSpielbestaetigungAdminRefusal,
  // Written by the match undo's replay alone.
  "PATCH /spiele/paarungen": (error) => replayRefusal(error, spiele.PAARUNGEN_REPLAY_REFUSALS) ?? null,
  "POST /spieler/{spieler_id}/adresswechsel": spieler.mapAdresswechselAntragRefusal,
  "POST /spieler/{spieler_id}/adresswechsel/einladen": spieler.mapAdresswechselLinkRefusal,
  "POST /spieler/adresswechsel": spielerQueries.mapSpielerAdresswechselRefusal,
  "POST /spieler/adresswechsel/ansicht": spielerQueries.mapSpielerAdresswechselAnsichtRefusal,
  "GET /spieler/kader/{team_id}/{saison_id}": TEAM_FORBIDDEN_PANEL,
  "PATCH /spieler/kader/{team_id}/{saison_id}/{spieler_id}": spieler.mapKaderZeileRefusal,
  "DELETE /spieler/kader/{team_id}/{saison_id}/{spieler_id}": SHARED_READER,
  // The player's and the referee's pages send a person the backend finds no confirmed row for to the
  // landing, as each page's own check sends a person holding none.
  "GET /spieler/selbst": (error) => (isFunktionLost(error) ? "the landing, in the page's stead" : null),
  "GET /schiedsrichter/selbst": (error) => (isFunktionLost(error) ? "the landing, in the page's stead" : null),
  "PATCH /spieler/selbst/einwilligung": (error) => konto.mapEigeneEinwilligungRefusal(error, MEDIEN_MIN_ALTER),
  "PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung": (error) => konto.mapEigeneEinwilligungRefusal(error, MEDIEN_MIN_ALTER),
  "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung": (error) => konto.mapEigeneEinwilligungRefusal(error, MEDIEN_MIN_ALTER),
  "PATCH /bewerbungen/{bewerbung_id}/person/einwilligung": konto.mapBewerbungEinwilligungRefusal,
  "PATCH /registrierungen/selbst/{registrierung_id}/einwilligung": konto.mapRegistrierungEinwilligungRefusal,
  "GET /teams/{team_id}/saisons/{saison_id}/person/sitze": TEAM_FORBIDDEN_PANEL,
  "POST /spieler/{spieler_id}/saisons": (error) => spieler.mapSquadRefusal(error) ?? spieler.mapAlreadyInSaisonRefusal(error),
  "PATCH /spieler/{spieler_id}/saisons/{saison_id}": spieler.mapSquadRefusal,
  "POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate": spieler.mapSquadRefusal,
  "POST /spielorte": spielorte.mapNameRefusal,
  "PATCH /spielorte/{spielort_id}": spielorte.mapNameRefusal,
  "DELETE /spielorte/{spielort_id}": spielorte.mapRetireRefusal,
  "PATCH /spieltage/{spieltag_id}": spieltage.mapSpieltagRefusal,
  "POST /teams": (error) => teams.mapShorthandRefusal(error, teams.SHORTHAND_TAKEN_ON_CREATE),
  "PATCH /teams/{team_id}": (error) => teams.mapShorthandRefusal(error, teams.SHORTHAND_TAKEN_ON_EDIT),
  "DELETE /teams/{team_id}": teams.mapRetireRefusal,
  "POST /teams/{team_id}/saisons": (error) => teams.mapEntryRefusal(error) ?? teams.mapAlreadyEnteredRefusal(error),
  "PATCH /teams/{team_id}/saisons/{saison_id}": teams.mapEntryRefusal,
  "POST /teams/{team_id}/saisons/{saison_id}/replace": teams.mapReplacementRefusal,
};

/**
 * Every operation outside the system tier the document publishes a refusal code on, with those codes.
 * Left out on the premise that a system caller hands no refusal to a person, the way
 * `fl_frontend/src/features/zustellung/notifications.ts :: meldeAngenommen` catches and logs one.
 */
const REFUSING = new Map(
  publishedOperations()
    .filter(({ declaration }) => keyTierOf(declaration) !== "system")
    .map(({ operation, answers }) => [operation, [...new Set(answers.map(({ code }) => code).filter(isRefusalCode))]] as const)
    .filter(([, codes]) => codes.length > 0),
);

describe("every published refusal against the mapper answering it", () => {
  /* Two listings reached by different routes, the document's and this table's, required to agree: a
     reader of the document that found nothing fails here rather than asking about nothing. */
  it("names a mapper for exactly the operations the document publishes a refusal on", () => {
    assert.deepEqual(
      [...REFUSING.keys()].filter((operation) => !Object.hasOwn(ANSWERED_BY, operation)).sort(),
      [],
      "a published refusal no mapper answers",
    );
    assert.deepEqual(
      Object.keys(ANSWERED_BY)
        .filter((operation) => !REFUSING.has(operation))
        .sort(),
      [],
      "a mapper for an operation that publishes no refusal",
    );
  });

  /* A code no mapper words reaches a person as the shared fallback, which names no reason and sends the
     admin to a retry the same rule refuses again (`.claude/rules/cross-surface.md`). */
  it("answers every published refusal code in its own words, at whatever status its rule answers", async () => {
    const unworded: string[] = [];
    for (const [operation, codes] of REFUSING) {
      const mapper = ANSWERED_BY[operation];
      if (mapper === undefined) continue;

      for (const code of codes) {
        if ((await answerSettled(operation, code, mapper)) === null) unworded.push(`${code} on ${operation}`);
      }
    }

    assert.deepEqual(unworded, []);
  });

  it("reads a second sentence as a way out only where it names one", () => {
    for (const [message, astray] of [
      ["Dieses Kürzel ist schon vergeben.", false],
      ["Dieses Kürzel ist schon vergeben. Bitte wähle ein anderes.", true],
      ["Diese E-Mail-Adresse steht auf der Sperrliste. Hebe die Sperre unter „Sperrliste“ auf.", false],
      ["Diese Auswahl gilt nicht mehr. Lade die Seite neu, oder trage die Schule neu ein.", false],
      ["Das geht nicht. Schreib uns an liga@example.org.", false],
      ["Das geht nicht. Lade die Seite neu. Schreib uns an liga@example.org.", true],
    ] as const) {
      assert.equal(feldAbweichung(message) !== null, astray, message);
    }
  });

  it("marks a field with one sentence about the value, and a second only for a way out the box cannot offer", async () => {
    const astray: string[] = [];
    for (const [operation, codes] of REFUSING) {
      const mapper = ANSWERED_BY[operation];
      if (mapper === undefined) continue;

      for (const code of codes) {
        const answer = await answerSettled(operation, code, mapper);
        const marked = typeof answer === "object" && answer !== null && "fieldErrors" in answer ? (answer.fieldErrors ?? {}) : {};
        for (const [field, message] of Object.entries(marked as Record<string, string>)) {
          const fault = feldAbweichung(message);
          if (fault !== null) astray.push(`${code} on ${operation} marks ${field} ${fault}: ${message}`);
        }
      }
    }

    assert.deepEqual(astray, []);
  });
});

/**
 * Where a way out the box cannot offer is named: a page or a control by its quoted name, the ban to
 * lift, an address to write to, the reload. What else a second sentence says repeats the box.
 */
const AUSWEG = /„[^“]+“|\bSperre\b|@|Lade die Seite neu/u;

/** How a field message breaks `docs/frontend/spec.md` §1.12's field register, or null where it keeps it. */
function feldAbweichung(message: string): string | null {
  // A sentence ending and a capital opening the next, which an abbreviation inside one never pairs.
  const [, second, ...more] = message.split(/(?<=[.!?])\s+(?=\p{Lu})/u);
  if (more.length > 0) return `in ${String(more.length + 2)} sentences`;

  return second === undefined || AUSWEG.test(second) ? null : "with a second sentence the box itself is the way out of";
}

/** Each undo's replay table, with the operations its replay sends. */
const REPLAYED: readonly (readonly [table: Readonly<Record<string, string>>, ...operations: string[]])[] = [
  [kontakte.KONTAKTE_REPLAY_REFUSALS, "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte"],
  [kontakte.STALE_BLOCK_REFUSAL, "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte"],
  [saisons.SAISON_REPLAY_REFUSALS, "PATCH /saisons/{saison_id}"],
  [schiedsrichter.SCHIEDSRICHTER_REPLAY_REFUSALS, "PATCH /schiedsrichter/{schiedsrichter_id}"],
  [spiele.PAARUNGEN_REPLAY_REFUSALS, "PATCH /spiele/paarungen"],
  [spieler.SQUAD_REPLAY_REFUSALS, "PATCH /spieler/{spieler_id}/saisons/{saison_id}"],
  [spielorte.SPIELORT_REPLAY_REFUSALS, "PATCH /spielorte/{spielort_id}"],
  [spieltage.SPIELTAG_REPLAY_REFUSALS, "PATCH /spieltage/{spieltag_id}"],
  [teams.TEAM_REPLAY_REFUSALS, "PATCH /teams/{team_id}", "PATCH /teams/{team_id}/saisons/{saison_id}"],
];

const SRC = path.resolve(import.meta.dirname, "..");

/** Every server action module, where each page-owned editor's undo replays through its table. */
const ACTION_MODULES = serverActionModules(20);

/** The page-owned editors' undos, a floor under the actions found running on `runAdminUndo`. */
const UNDO_FLOOR = 8;

/**
 * Each undo replaying through no table of its own, by `<module> :: <export>`, and why: one answered by
 * the spine's fallback alone never names the reason its rule refused for.
 */
const REPLAYS_THROUGH_NO_TABLE: Readonly<Record<string, string>> = {};

function relativeTo(file: string, root = SRC): string {
  return path.relative(root, file).split(path.sep).join("/");
}

/**
 * Each undo `file` declares at its top level, a function or a variable holding one, found by its
 * `runAdminUndo` call, with every table it hands a replay's wording: `undefined` for a table no import
 * reaches, one of the module's own.
 */
async function undosOf(file: string): Promise<{ undo: string; tables: { name: string; table: unknown }[] }[]> {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imported = new Map<string, { module: string; name: string }>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const resolved = specifier.startsWith("@/") ? path.join(SRC, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements)
      imported.set(element.name.text, { module: resolved, name: (element.propertyName ?? element.name).text });
  }

  /** Whether `node` calls the function `name` anywhere below it, and the table each such call hands on. */
  const callsOf = (node: ts.Node, name: RegExp): string[] => {
    const found: string[] = [];
    const visit = (child: ts.Node): void => {
      if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) && name.test(child.expression.text)) {
        found.push(child.arguments[1]?.getText(source) ?? "");
      }
      ts.forEachChild(child, visit);
    };
    visit(node);
    return found;
  };

  // A variable's initializer as well as a declaration: `export const undo… = (…) => runAdminUndo(…)` is
  // an undo as much as the function form is.
  const declared = source.statements.flatMap((statement): { name: string; node: ts.Node }[] => {
    if (ts.isFunctionDeclaration(statement)) return statement.name === undefined ? [] : [{ name: statement.name.text, node: statement }];
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) && declaration.initializer !== undefined
        ? [{ name: declaration.name.text, node: declaration.initializer }]
        : [],
    );
  });
  const undos = declared.flatMap(({ name, node }) =>
    callsOf(node, /^runAdminUndo$/).length > 0
      ? [{ undo: `${relativeTo(file)} :: ${name}`, passed: callsOf(node, /^(?:refusedReplay|replayRefusal|partlyRestored)$/) }]
      : [],
  );

  return Promise.all(
    undos.map(async ({ undo, passed }) => ({
      undo,
      tables: await Promise.all(
        passed.map(async (name) => {
          const from = imported.get(name);
          if (from === undefined) return { name, table: undefined };
          const exports = (await import(pathToFileURL(`${from.module}.ts`).href)) as Record<string, unknown>;
          return { name, table: exports[from.name] };
        }),
      ),
    })),
  );
}

describe("every undo's replay table", () => {
  /* Read off each undo, found by its spine call, rather than this table: an undo with no table, a table
     this file leaves out, or one a module keeps to itself fails here instead of going unjudged. */
  it("is judged here, and every undo replays through one", async () => {
    const undos = (await Promise.all(ACTION_MODULES.map(undosOf))).flat();
    const replayed = undos.flatMap(({ undo, tables }) => tables.map(({ name, table }) => ({ undo, name, table })));

    assert.ok(undos.length >= UNDO_FLOOR, `${String(undos.length)} undos found, under this sweep's floor of ${String(UNDO_FLOOR)}`);
    assert.deepEqual(
      undos.filter(({ undo, tables }) => tables.length === 0 && !Object.hasOwn(REPLAYS_THROUGH_NO_TABLE, undo)).map(({ undo }) => undo),
      [],
      "an undo replaying through no table of its own, which the shared fallback alone answers",
    );
    assert.deepEqual(
      replayed.filter(({ table }) => !REPLAYED.some(([judged]) => judged === table)).map(({ undo, name }) => `${undo}: ${name}`),
      [],
      "a replay table this file does not judge",
    );
    // An exemption outliving its undo would excuse the next one written under its name.
    assert.deepEqual(
      Object.keys(REPLAYS_THROUGH_NO_TABLE).filter((undo) => !undos.some((found) => found.undo === undo)),
      [],
    );
  });

  /* `fl_frontend/src/shared/testing/undoActions.ts :: assertEachRefusalCloses` holds the other direction:
     a row for a code nothing sends is German nobody meets. */
  it("words only codes one of its replayed operations publishes", () => {
    const stray = REPLAYED.flatMap(([table, ...operations]) => {
      const published = new Set(operations.flatMap((operation) => publishedRefusals(operation)));
      return Object.keys(table)
        .filter((code) => !published.has(code))
        .map((code) => `${code} beside ${operations.join(" and ")}`);
    });

    assert.deepEqual(stray, [], "a replay table words a code its replayed operations no longer publish");
  });
});
