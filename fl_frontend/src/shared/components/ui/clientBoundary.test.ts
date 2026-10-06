import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { elementsIn, parseModule } from "@/shared/testing/jsxReader.ts";

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/** The trees a page renders from. `core` holds no component, so no boundary runs through it. */
const TREES = ["features", "shared", "app"];

const rel = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** The directive as a module carries it: the first statement, a bare string expression. */
function declaresClient(source: ts.SourceFile): boolean {
  const first = source.statements[0];

  return (
    first !== undefined && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use client"
  );
}

/** Every name a module binds from HeroUI, a namespace import included. */
function heroUiNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || !/^@heroui\/react(\/|$)/.test(statement.moduleSpecifier.text)) continue;

    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) names.add(bindings.name.text);
    else for (const element of bindings.elements) names.add(element.name.text);
  }

  return names;
}

/** One specifier as a path relative to `src`, or `null` where it names nothing in this tree. */
function resolveSpecifier(specifier: string, from: string, sources: ReadonlyMap<string, string>): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  else return null;

  for (const suffix of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (sources.has(base + suffix)) return base + suffix;
  return null;
}

function importedBy(file: string, source: ts.SourceFile, sources: ReadonlyMap<string, string>): string[] {
  const found: string[] = [];

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;

    const resolved = resolveSpecifier(statement.moduleSpecifier.text, file, sources);
    if (resolved !== null) found.push(resolved);
  }

  return found;
}

/**
 * Every module React compiles for the browser.
 *
 * The directive marks a BOUNDARY rather than a file: what a client module imports is client too and
 * carries none, so the directive alone reports an editor's own sections as server.
 */
function clientModules(sources: ReadonlyMap<string, string>): Set<string> {
  const parsed = new Map([...sources].map(([file, text]) => [file, parseModule(file, text)]));
  const client = new Set([...parsed].filter(([, source]) => declaresClient(source)).map(([file]) => file));

  for (let growing = true; growing;) {
    growing = false;
    for (const file of [...client]) {
      const source = parsed.get(file);
      if (source === undefined) continue;

      for (const imported of importedBy(file, source, sources)) {
        if (client.has(imported)) continue;
        client.add(imported);
        growing = true;
      }
    }
  }

  return client;
}

/** A value React would have to serialise and cannot: a function written at the attribute itself. */
function isFunctionValue(value: ts.Node | undefined): boolean {
  if (value === undefined || !ts.isJsxExpression(value) || value.expression === undefined) return false;

  return ts.isArrowFunction(value.expression) || ts.isFunctionExpression(value.expression);
}

/**
 * Each attribute this module hands a HeroUI element that a server render cannot send across the
 * boundary: a function written there, and `render`, which takes one however it is written.
 */
function unserialisableProps(file: string, text: string): string[] {
  const source = parseModule(file, text);
  const imported = heroUiNames(source);
  if (imported.size === 0) return [];

  return elementsIn(source).flatMap((element) => {
    const root = element.tag.split(".")[0] ?? "";
    if (!imported.has(root)) return [];

    return [...element.attributes]
      .filter(([name, value]) => name === "render" || isFunctionValue(value))
      .map(([name]) => `${file}:${String(element.line)} <${element.tag} ${name}=>`);
  });
}

/** Whether `node` sits in a type, where a client export is erased rather than sent. */
function inType(node: ts.Node): boolean {
  for (let at: ts.Node | undefined = node.parent; at !== undefined; at = at.parent) if (ts.isTypeNode(at)) return true;
  return false;
}

/**
 * Whether a client export's use is one React serves from the server: rendered as a tag, a member of one
 * included, or handed on whole as a prop. A call or a read meets a reference, not the value.
 */
function isRendered(use: ts.Node): boolean {
  let top = use;
  while (ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top) top = top.parent;
  const parent = top.parent;

  if ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent) || ts.isJsxClosingElement(parent)) && parent.tagName === top)
    return true;
  return ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent) && parent.expression === top;
}

/** Each use a server module makes of a value it imports from a `"use client"` module, other than rendering it. */
function clientValuesUsed(file: string, text: string, sources: ReadonlyMap<string, string>): string[] {
  const source = parseModule(file, text);
  const bound = new Map<string, string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (clause === undefined || clause.isTypeOnly) continue;

    const target = resolveSpecifier(statement.moduleSpecifier.text, file, sources);
    const targetText = target === null ? undefined : sources.get(target);
    if (target === null || targetText === undefined || !declaresClient(parseModule(target, targetText))) continue;

    if (clause.name !== undefined) bound.set(clause.name.text, target);
    const bindings = clause.namedBindings;
    if (bindings !== undefined && ts.isNamespaceImport(bindings)) bound.set(bindings.name.text, target);
    else for (const element of bindings?.elements ?? []) if (!element.isTypeOnly) bound.set(element.name.text, target);
  }
  if (bound.size === 0) return [];

  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isIdentifier(node) && bound.has(node.text) && !inType(node) && !isRendered(node)) {
      const isMemberName = ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
      const isKey = ts.isPropertyAssignment(node.parent) && node.parent.name === node;
      if (!isMemberName && !isKey) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push(`${file}:${String(line)} ${node.text} from ${bound.get(node.text) ?? ""}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

const SOURCES = new Map(
  filesUnder(SRC, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 250).map((file) => [rel(file), readFileSync(file, "utf8")]),
);

const CLIENT = clientModules(SOURCES);

/** The population below: a module React renders on the SERVER that binds a HeroUI name. */
const SERVER_MODULES_USING_HEROUI = [...SOURCES].filter(
  ([file, text]) =>
    file.endsWith(".tsx") &&
    TREES.some((tree) => file.startsWith(`${tree}/`)) &&
    !CLIENT.has(file) &&
    heroUiNames(parseModule(file, text)).size > 0,
);

/* A module handing a HeroUI element a function, in the four shapes one arrives in, beside the three
   a server render sends across the boundary without trouble. */
const SAMPLE = {
  aRenderProp: 'import { Card } from "@heroui/react";\nconst c = <Card.Title render={(p) => <h2 {...p} />} />;',
  aHandler: 'import { Button } from "@heroui/react";\nconst c = <Button onPress={() => go()}>Los</Button>;',
  aFunctionExpression: 'import { Button } from "@heroui/react";\nconst c = <Button onPress={function () {}}>Los</Button>;',
  aNamespacedTag: 'import * as HeroUI from "@heroui/react";\nconst c = <HeroUI.Button onPress={() => go()}>Los</HeroUI.Button>;',
  aPlainElement: 'import { Card } from "@heroui/react";\nconst c = <form onSubmit={() => go()} />;',
  aSerialisableProp: 'import { Card } from "@heroui/react";\nconst c = <Card.Title className="x">Titel</Card.Title>;',
  anotherPackage: 'import { Card } from "@gravity-ui/icons";\nconst c = <Card render={(p) => <h2 {...p} />} />;',
};

/** A boundary two imports deep, beside a module no client module reaches. */
const GRAPH_SAMPLE = new Map([
  ["app/page.tsx", 'import { Editor } from "@/features/editor.tsx";\nimport { Grid } from "./grid.tsx";'],
  ["features/editor.tsx", '"use client";\nimport { Section } from "./section.tsx";'],
  ["features/section.tsx", 'import { Field } from "./field.tsx";'],
  ["features/field.tsx", "export const Field = () => null;"],
  ["app/grid.tsx", "export const Grid = () => null;"],
]);

describe("what a Server Component hands a HeroUI element", () => {
  /* Every shape, because the failure is invisible to the toolchain: `tsc` types the prop, the build
     emits it, and the page answers 500 at request time with a digest and nothing else
     (`.claude/rules/frontend.md`). */
  it("is read out of a module whichever way the function and the tag are written", () => {
    const found = (source: string): string[] => unserialisableProps("sample.tsx", source);

    assert.equal(found(SAMPLE.aRenderProp).length, 1, "a render prop reads as serialisable");
    assert.equal(found(SAMPLE.aHandler).length, 1, "an arrow handler reads as serialisable");
    assert.equal(found(SAMPLE.aFunctionExpression).length, 1, "a `function` expression reads as serialisable");
    assert.equal(found(SAMPLE.aNamespacedTag).length, 1, "a namespaced HeroUI tag is not read as one");
    assert.deepEqual(found(SAMPLE.aPlainElement), [], "a plain element's handler reads as crossing a boundary");
    assert.deepEqual(found(SAMPLE.aSerialisableProp), [], "a serialisable prop reads as a function");
    assert.deepEqual(found(SAMPLE.anotherPackage), [], "another package's component is read as HeroUI's");
  });

  /* The inverse trap is this boundary read the other way — `.claude/rules/frontend.md` says to grep
     for render props BEFORE deleting a `"use client"` — and it needs the graph rather than the
     directive too. */
  it("is decided by the import graph rather than by the directive on the file", () => {
    const client = clientModules(GRAPH_SAMPLE);

    assert.ok(client.has("features/editor.tsx"), "the module carrying the directive is not client");
    assert.ok(client.has("features/section.tsx"), "a module the client editor imports is read as server");
    assert.ok(client.has("features/field.tsx"), "the boundary stops at the first import rather than carrying on");
    assert.ok(!client.has("app/grid.tsx"), "a module no client module reaches is read as client");
    assert.ok(!client.has("app/page.tsx"), "the page importing a client module is read as client itself");
  });

  it("is judged over a population the walk actually found", () => {
    assert.ok(SOURCES.size > 250, `the walk found ${String(SOURCES.size)} modules`);
    assert.ok(CLIENT.size > 0, "the graph reaches no client module at all");
    assert.ok(SERVER_MODULES_USING_HEROUI.length > 0, "no server module binds a HeroUI name, so the case below holds of nothing");
  });

  /* The defect this exists for: `TeamsGrid` renders `TeamCard` on the server, and one `render` prop
     inside it answered every visit to `/dashboard/teams` with a 500. */
  it("is never a function, so nothing it renders has to be serialised", () => {
    const handing = SERVER_MODULES_USING_HEROUI.flatMap(([file, text]) => unserialisableProps(file, text));

    assert.deepEqual(handing, [], `these hand a HeroUI element a function from a Server Component:\n  ${handing.join("\n  ")}`);
  });
});

/** A client module's exports as a server module meets them, each beside the import it arrives through. */
const CLIENT_EXPORT_SAMPLE = new Map([
  [
    "features/view.tsx",
    '"use client";\nexport function View() { return null; }\nexport function startOf() { return 1; }\nexport const LABEL = "x";',
  ],
  ["features/plain.ts", "export function startOf() { return 1; }"],
]);
const usesIn = (page: string): string[] => clientValuesUsed("app/page.tsx", page, new Map([...CLIENT_EXPORT_SAMPLE, ["app/page.tsx", page]]));

describe("what a server module takes from a client module", () => {
  /* Each shape a use arrives in: the toolchain types and builds every one, and the page answers 500
     at request time ("Attempted to call startOf() from the server"), which a test rendering the view
     itself never meets. */
  it("is read out of a module whichever way the export is used", () => {
    const view = 'import { View, startOf, LABEL } from "@/features/view.tsx";\n';

    assert.equal(usesIn(`${view}const s = startOf();`).length, 1, "a call reads as rendered");
    assert.equal(usesIn(`${view}const s = LABEL.length;`).length, 1, "a read of a constant reads as rendered");
    assert.equal(usesIn('import * as V from "@/features/view.tsx";\nconst s = V.startOf();').length, 1, "a namespaced call reads as rendered");
    assert.deepEqual(usesIn(`${view}const c = <View />;`), [], "a rendered tag reads as a call");
    assert.deepEqual(usesIn(`${view}const c = <Shell body={View} />;`), [], "a client export handed on as a prop reads as a call");
    assert.deepEqual(
      usesIn('import { startOf } from "@/features/plain.ts";\nconst s = startOf();'),
      [],
      "a plain module's export reads as a client one",
    );
    assert.deepEqual(usesIn('import type { View } from "@/features/view.tsx";\nlet v: typeof View;'), [], "a type import reads as a value");
  });

  it("is judged over a population the walk actually found", () => {
    assert.ok([...SOURCES.keys()].filter((file) => !CLIENT.has(file)).length > 100, "the walk found few server modules");
  });

  /* The defect this exists for: the referee's address page called its view's `startOf` on the server,
     and every link it opened answered 500. */
  it("is only ever rendered or handed on, never called or read", () => {
    const taking = [...SOURCES]
      .filter(([file]) => !CLIENT.has(file) && !file.startsWith("shared/testing/"))
      .flatMap(([file, text]) => clientValuesUsed(file, text, SOURCES));

    assert.deepEqual(taking, [], `these call or read a client module's export on the server:\n  ${taking.join("\n  ")}`);
  });
});
