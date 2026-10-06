import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";

import { filesUnder, isTestFile, routeHandlerFiles, serverActionModules } from "@/core/treeWalk.ts";

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

/** Direct calls alone: `UNREAD_SENDS` refuses every other way a module could reach a request. */
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

function isExported(statement: ts.Statement): boolean {
  return ts.canHaveModifiers(statement) && (ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false);
}

/**
 * Every server action module, by the slice its directory names, with its syntax tree: a person's write
 * is a door to a request as an administrator's is.
 */
const ACTION_SOURCES = serverActionModules(20).map((file) => ({
  file,
  slice: path.basename(path.dirname(file)),
  source: ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true),
}));

/** Every exported action of every slice, how it declares its step-up and the requests it sends, read off each module's syntax tree. */
const ACTIONS = ACTION_SOURCES.flatMap(({ slice, source }) => {
  const imported = mutationImports(source, slice);

  return source.statements.flatMap((statement) => {
    if (!isExported(statement) || !ts.isFunctionDeclaration(statement) || statement.name === undefined || statement.body === undefined)
      return [];
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
  routeHandlerFiles(8)
    .filter((file) => path.dirname(path.dirname(path.dirname(file))) === UNDO_ROUTES && path.basename(path.dirname(file)) === "undo")
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

/** A module named `mutations`, however its specifier spells it: wider than `MUTATIONS_MODULE`, so a spelling that reader misses is met here. */
const ANY_MUTATIONS_MODULE = /(?:^|\/)mutations(?:\.[cm]?[jt]s)?$/;

/** The slice a mutations specifier names, read off its path rather than off the reader's pattern. */
function sliceNamed(specifier: string, ownSlice: string): string {
  const segments = specifier.split("/");
  return segments.length === 2 && segments[0] === "." ? ownSlice : (segments.at(-2) ?? ownSlice);
}

/** Whether `node` is a value naming its binding: a property's own name and a type position send nothing. */
function namesTheBinding(node: ts.Identifier): boolean {
  const { parent } = node;
  if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  // `export { local as exported }` names the binding by `local` alone.
  if (ts.isExportSpecifier(parent) && parent.propertyName !== undefined && parent.name === node) return false;
  for (let at: ts.Node = parent; !ts.isSourceFile(at); at = at.parent) if (ts.isTypeNode(at)) return false;
  return true;
}

/** Whether `node` sits in the body of a top-level exported function declaration, the one place `ACTIONS` reads. */
function inExportedAction(node: ts.Node): boolean {
  let statement: ts.Node = node;
  while (!ts.isSourceFile(statement.parent)) statement = statement.parent;
  const body = ts.isFunctionDeclaration(statement) && isExported(statement) ? statement.body : undefined;
  return body !== undefined && node.getStart() >= body.getStart() && node.getEnd() <= body.getEnd();
}

/** One module's reach into the slices' requests: every request it names, and every way it names one that `read` would miss. */
type Reach = {
  readonly referenced: readonly string[];
  readonly unread: readonly string[];
  readonly reexportedWhole: readonly string[];
  readonly importedDynamically: readonly string[];
};

/**
 * Every request `source` names as `slice :: export`, found by a walk of its own rather than by the
 * reader's, and each reference the reader cannot attribute: `read` is where a direct call is read.
 */
function reachOf(source: ts.SourceFile, ownSlice: string, read: (call: ts.Node) => boolean): Reach {
  const bindings = new Map<string, string>();
  const unread: string[] = [];
  const referenced = new Set<string>();
  const reexportedWhole: string[] = [];
  const importedDynamically: string[] = [];
  for (const statement of source.statements) {
    // A re-export hands a request to every importer of this module, none of which the reader follows.
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
      const specifier = statement.moduleSpecifier.text;
      if (!ANY_MUTATIONS_MODULE.test(specifier) || statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (clause === undefined || !ts.isNamedExports(clause)) reexportedWhole.push(specifier);
      for (const element of clause !== undefined && ts.isNamedExports(clause) ? clause.elements : []) {
        if (element.isTypeOnly) continue;
        const request = `${sliceNamed(specifier, ownSlice)} :: ${(element.propertyName ?? element.name).text}`;
        referenced.add(request);
        unread.push(`${request} re-exported, where the reader reads no call of it`);
      }
      continue;
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!ANY_MUTATIONS_MODULE.test(specifier) || clause === undefined || clause.isTypeOnly) continue;

    if (!MUTATIONS_MODULE.test(specifier)) unread.push(`${specifier}, a specifier the reader does not take`);
    if (clause.name !== undefined) unread.push(`${specifier}'s default import`);
    const named = clause.namedBindings;
    if (named !== undefined && ts.isNamespaceImport(named)) unread.push(`${specifier} as a namespace`);
    if (named === undefined || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      if (!element.isTypeOnly)
        bindings.set(element.name.text, `${sliceNamed(specifier, ownSlice)} :: ${(element.propertyName ?? element.name).text}`);
    }
  }

  const visit = (node: ts.Node): void => {
    // A re-export naming a module is read above; `export { send }` names a local binding, which is a reference here.
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)) return;
    // Its module's exports reach the caller as properties of a value no binding above names.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [specifier] = node.arguments;
      if (specifier === undefined || !ts.isStringLiteralLike(specifier))
        importedDynamically.push("a dynamic import of a module no literal names");
      else if (ANY_MUTATIONS_MODULE.test(specifier.text)) importedDynamically.push(`${specifier.text} imported dynamically`);
    }
    const request = ts.isIdentifier(node) && namesTheBinding(node) ? bindings.get(node.text) : undefined;
    if (request !== undefined) {
      referenced.add(request);
      const called = ts.isCallExpression(node.parent) && node.parent.expression === node;
      if (!called || !read(node)) unread.push(`${request} named where the reader reads no call of it`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return {
    referenced: [...referenced],
    unread: [...unread, ...reexportedWhole.map((specifier) => `${specifier} re-exported whole`), ...importedDynamically],
    reexportedWhole,
    importedDynamically,
  };
}

const SOURCE_ROOT = path.resolve(import.meta.dirname, "..", "..");

const relative = (file: string): string => path.relative(SOURCE_ROOT, file).split(path.sep).join("/");

/** A server action module's reach, read where `ACTIONS` reads one: a direct call inside an exported function's body. */
export function actionReachOf(source: ts.SourceFile, slice: string): Reach {
  return reachOf(source, slice, inExportedAction);
}

const ACTION_REACH = ACTION_SOURCES.map(({ file, slice, source }) => ({ file, reach: actionReachOf(source, slice) }));

// The whole file: `UNDO_REPLAYS` reads a replay's every direct call, wherever in the route it sits.
// Resolved again, `fileName` being the compiler's own spelling of the path, which on Windows the walk's is not.
const REPLAY_REACH = [...UNDO_ROUTE_SOURCES].map(([slice, source]) => ({
  file: path.resolve(source.fileName),
  reach: reachOf(source, slice, () => true),
}));

/**
 * Each step-up write's request a module the reader skips names, and each mutations module it re-exports
 * whole: an action calling that module sends the write through a door no listing above names.
 */
export function helperReachOf(source: ts.SourceFile, slice: string): string[] {
  const { referenced, reexportedWhole, importedDynamically } = reachOf(source, slice, () => false);
  return [
    ...referenced.filter((request) => STEP_UP_REQUESTS.has(request)).map((request) => `${request}, a step-up write's request`),
    ...reexportedWhole.map((specifier) => `${specifier} re-exported whole`),
    ...importedDynamically,
  ];
}

const HELPER_SENDS = filesUnder(SOURCE_ROOT, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 500).flatMap((file) => {
  if ([...ACTION_REACH, ...REPLAY_REACH].some((read) => read.file === file)) return [];
  const text = readFileSync(file, "utf8");
  if (!text.includes("mutations")) return [];

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  return helperReachOf(source, path.basename(path.dirname(file))).map((why) => `${relative(file)}: ${why}`);
});

/**
 * Every reach into a request the reader above cannot attribute: an action's, a replay's, or a helper's
 * sending a step-up write's request. Empty, or `UNDECLARED_SENDS` and `UNDO_REPLAYS` answer for less than the tree sends.
 */
export const UNREAD_SENDS: readonly string[] = [
  ...[...ACTION_REACH, ...REPLAY_REACH].flatMap(({ file, reach }) => reach.unread.map((why) => `${relative(file)}: ${why}`)),
  ...HELPER_SENDS,
];

/** Every request an action or a replay names, by the walk above: the second listing the reader's own is held to. */
export const REQUESTS_NAMED: ReadonlySet<string> = new Set([...ACTION_REACH, ...REPLAY_REACH].flatMap(({ reach }) => reach.referenced));

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
  "features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx": { patchSaisonTeamKontakteAction: "one-press" },
  "features/kontakte/components/forms/AdminKontakteEditForm/FormKontaktEinladen.tsx": { einladeKontaktAction: "one-press" },
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
  "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/FormAdresswechselSection.tsx": {
    einladeAdresswechselAction: "one-press",
    verwirfAdresswechselAction: "one-press",
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
