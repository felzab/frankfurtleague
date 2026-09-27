import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { filesUnder } from "@/core/treeWalk.ts";

const SLICES = path.resolve(import.meta.dirname, "..", "..", "features");

/** How an exported action declares its step-up: before its body, inside it, or not at all. */
function declarationOf(body: ts.Node): "declared" | "conditional" | null {
  let found: "declared" | "conditional" | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      // The spine's three-argument form is the declared one; a `{ stepUp: false }` spelled out declares nothing.
      const [, declared] = node.arguments;
      const spine = node.expression.text === "runAdminMutation" && node.arguments.length === 3;
      const disowned =
        declared !== undefined &&
        ts.isObjectLiteralExpression(declared) &&
        declared.properties.some((property) => ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.FalseKeyword);
      if (spine && !disowned) found = "declared";
      else if (node.expression.text === "refuseUnconfirmed" && found === null) found = "conditional";
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

const MUTATIONS_MODULE = /^(?:\.\/|@\/features\/(\w+)\/)mutations$/;

/** The request functions `source` imports from a slice's `mutations.ts`, by local name, each as `slice :: export`. */
function mutationImports(source: ts.SourceFile, ownSlice: string): Map<string, string> {
  const imported = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = MUTATIONS_MODULE.exec(statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    if (specifier === null || bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imported.set(element.name.text, `${specifier[1] ?? ownSlice} :: ${(element.propertyName ?? element.name).text}`);
    }
  }
  return imported;
}

/**
 * Direct calls alone: a request sent through a helper module is not seen, which the floor in
 * `fl_frontend/src/shared/utils/adminStepUp.test.ts` catches only where a replay sends nothing else.
 */
function requestsSent(node: ts.Node, imported: ReadonlyMap<string, string>): string[] {
  const sent = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const request = imported.get(child.expression.text);
      if (request !== undefined) sent.add(request);
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return [...sent];
}

/** Every exported action of every slice, how it declares its step-up and the requests it sends, read off each `actions.ts`'s syntax tree. */
const ACTIONS = filesUnder(SLICES, (name) => name === "actions.ts", 10).flatMap((file) => {
  const slice = path.basename(path.dirname(file));
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const imported = mutationImports(source, slice);

  return source.statements.flatMap((statement) => {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported || !ts.isFunctionDeclaration(statement) || statement.name === undefined || statement.body === undefined) return [];
    return [{ name: statement.name.text, slice, declaration: declarationOf(statement.body), sends: requestsSent(statement.body, imported) }];
  });
});

const DECLARED = ACTIONS.flatMap(({ declaration, ...action }) => (declaration === null ? [] : [{ ...action, declaration }]));

/**
 * Every administrator action the server holds to the step-up window, by export against its slice
 * (`docs/frontend/spec.md :: I432`), read off its declaration. `fl_frontend/src/shared/utils/adminStepUp.test.ts`
 * holds it to what the actions refuse and to the callers registered below.
 */
export const STEP_UP_WRITES: Readonly<Record<string, string>> = Object.fromEntries(DECLARED.map(({ name, slice }) => [name, slice]));

const UNDO_ROUTES = path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin");

/** Whether a route's `handleUndoRequest` call hands it a `stepUp` of its own. */
function declaresStepUp(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "handleUndoRequest") {
    const [, route] = node.arguments;
    return (
      route !== undefined && ts.isObjectLiteralExpression(route) && route.properties.some((property) => property.name?.getText() === "stepUp")
    );
  }
  return ts.forEachChild(node, declaresStepUp) ?? false;
}

/** Every undo route, by the slice its directory names, with its syntax tree. */
const UNDO_ROUTE_SOURCES: ReadonlyMap<string, ts.SourceFile> = new Map(
  filesUnder(UNDO_ROUTES, (name) => name === "route.ts", 8)
    .filter((file) => path.basename(path.dirname(file)) === "undo")
    .map((file) => [
      path.basename(path.dirname(path.dirname(file))),
      ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true),
    ]),
);

/**
 * Every undo route a replay of which the server holds to the step-up window, by the slice its directory
 * names, read off its declaration as the actions are; a route's replay is a save, and is judged as one.
 */
export const STEP_UP_ROUTES: ReadonlySet<string> = new Set(
  [...UNDO_ROUTE_SOURCES].filter(([, source]) => declaresStepUp(source)).map(([slice]) => slice),
);

/**
 * Every request each undo route's replay sends, read off its calls rather than its declaration: the
 * second listing `STEP_UP_ROUTES` is held to, since a route dropping its `stepUp` drops out of that one.
 */
export const UNDO_REPLAYS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  [...UNDO_ROUTE_SOURCES].map(([slice, source]) => [slice, requestsSent(source, mutationImports(source, slice))]),
);

/** Every request a step-up write sends, as `slice :: export`: an undo route replaying one is a second door to that write. */
export const STEP_UP_REQUESTS: ReadonlySet<string> = new Set(DECLARED.flatMap(({ sends }) => sends));

/**
 * Every request each action declaring no step-up sends, by export: one sending a step-up write's
 * request is that write through a second door, the rule being the write's and never its caller's.
 */
export const UNDECLARED_SENDS: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  ACTIONS.filter(({ declaration }) => declaration === null).map(({ name, sends }) => [name, sends]),
);

/** Refused from a stale session on some calls alone, the action judging its own payload before `refuseUnconfirmed`. */
export const CONDITIONALLY_STEPPED_UP: ReadonlySet<string> = new Set(
  DECLARED.filter(({ declaration }) => declaration === "conditional").map(({ name }) => name),
);

/**
 * How a caller's press asks: on its armed press, on its only one, through the create form it declares
 * the step-up to, or `never`, for a conditional action sent only on calls the server lets through.
 */
export type StepUpPress = "two-press" | "one-press" | "create" | "never";

// Driven by kind: two-press by `fl_frontend/src/shared/components/ui/confirmPanels.test.ts`, the rest
// by `fl_frontend/src/features/admin/stepUpCallers.test.ts`.
/**
 * Every module sending a step-up write, and how each press asks, held to every module importing one
 * by the syntax sweep in `fl_frontend/src/features/admin/stepUpCallers.test.ts`.
 */
export const STEP_UP_CALLERS: Readonly<Record<string, Readonly<Record<string, StepUpPress>>>> = {
  "features/bewerbungen/components/forms/AdminBewerbungAblehnenSection.tsx": { ablehnenBewerbungAction: "two-press" },
  "features/bewerbungen/components/forms/AdminBewerbungAnnehmenSection.tsx": { annehmenBewerbungAction: "two-press" },
  "features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx": {
    einwilligungErneutSendenAction: "one-press",
    kontaktEmailKorrigierenAction: "one-press",
    besetzeKontaktSitzAction: "one-press",
  },
  "features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx": { patchSaisonTeamKontakteAction: "never" },
  "features/kontakte/components/forms/AdminKontakteEditForm/FormKontakteLoeschenSection.tsx": { patchSaisonTeamKontakteAction: "two-press" },
  "features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktErasure.tsx": { eraseKontaktpersonAction: "two-press" },
  "features/saisons/components/forms/AdminCreateSaisonForm.tsx": { postSaisonAction: "create" },
  "features/saisons/components/forms/AdminSaisonEditForm/FormEinladungVersandSection.tsx": { postEinladungVersandAction: "two-press" },
  "features/saisons/components/forms/AdminSaisonEditForm/FormRolloverSection.tsx": { activateSaisonAction: "two-press" },
  "features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx": {
    generateSpielplanAction: "two-press",
    undrawSpielplanAction: "two-press",
  },
  "features/saisons/components/forms/AdminSaisonEditForm/FormTeamErsatzSection.tsx": { replaceSaisonTeamAction: "two-press" },
  "features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx": { reactivateSchiedsrichterAction: "one-press" },
  "features/schiedsrichter/components/forms/AdminCreateSchiedsrichterForm.tsx": { postSchiedsrichterAction: "create" },
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx": {
    patchSchiedsrichterAction: "one-press",
  },
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAnonymisierenSection.tsx": {
    anonymiseSchiedsrichterAction: "two-press",
  },
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormBestaetigungSection.tsx": {
    einladeSchiedsrichterAction: "one-press",
  },
  "features/schiedsrichter/components/views/AdminSchiedsrichterEditView.tsx": { reactivateSchiedsrichterAction: "one-press" },
  "features/sperrliste/components/forms/AdminSperreAufhebenPanel.tsx": { deleteSperreAction: "two-press" },
  "features/berechtigungen/components/forms/AdminCreateBerechtigungForm.tsx": { postBerechtigungAction: "create" },
  "features/berechtigungen/components/forms/AdminBerechtigungEntziehenPanel.tsx": { deleteBerechtigungAction: "two-press" },
  "features/berechtigungen/components/forms/AdminBerechtigungStufePanel.tsx": { patchBerechtigungAction: "two-press" },
  "features/spieler/components/forms/AdminSpielerEditForm/FormLoeschenSection.tsx": { eraseSpielerAction: "two-press" },
  "features/teams/components/forms/AdminTeamEditForm/FormEinladungSection.tsx": {
    postEinladungAction: "two-press",
    deleteEinladungAction: "two-press",
    mailEinladungAction: "one-press",
  },
  "features/teams/components/forms/AdminCreateTeamForm.tsx": { postTeamAction: "create" },
  "features/teams/components/forms/AdminTeamEditForm/FormSaisonSection.tsx": { postSaisonTeamAction: "one-press" },
};
