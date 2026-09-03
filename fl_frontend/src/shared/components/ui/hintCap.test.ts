import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

/** The cap is a lead and four blocks, a `note` among them, together about this many characters (`docs/frontend/spec.md` §1.12). */
const HINT_CHAR_CAP = 350;
const HINT_POINT_CAP = 4;

/**
 * German abbreviations whose period ends no sentence. Listed rather than pattern-matched: every
 * pattern that reads a lone period as an abbreviation also reads the end of a sentence as one.
 */
const ABBREVIATIONS = ["z.B.", "ca.", "bzw.", "u.a.", "etc.", "ggf.", "evtl.", "inkl.", "max.", "min.", "Nr.", "Std.", "Mio.", "Mrd."];

const collectSources = (dir: string): string[] => filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 200);

const sources = new Map(
  collectSources(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
);

/**
 * The cap binds the content, so both panel mechanisms are swept: a site the sweep cannot see is one exempt for not
 * having moved. `IconTooltip` is absent, drawing `HINT_SURFACE`, the label chip.
 */
const MEASURED_TAGS = new Set(["Hint", "InfoHint"]);

/** One measured element in the tree, with its attributes reachable by name and its children readable. */
type HintSite = {
  file: string;
  line: number;
  tag: string;
  attributes: Map<string, ts.JsxAttributeValue | undefined>;
  /** `InfoHint` writes its panel here; `Hint` writes it into a `body` attribute instead. */
  children: readonly ts.JsxChild[];
};

function hintSitesIn(file: string, text: string): HintSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites: HintSite[] = [];

  const visit = (node: ts.Node): void => {
    // The element, never its opening tag: matching both would count every `InfoHint` with children twice.
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(source);

      if (MEASURED_TAGS.has(tag)) {
        const attributes = new Map<string, ts.JsxAttributeValue | undefined>();
        for (const attribute of opening.attributes.properties) {
          if (ts.isJsxAttribute(attribute)) attributes.set(attribute.name.getText(source), attribute.initializer);
        }
        sites.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          tag,
          attributes,
          children: ts.isJsxElement(node) ? node.children : [],
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return sites;
}

const sites = [...sources].flatMap(([file, text]) => hintSitesIn(file, text));

/**
 * A statically readable string, or `null`. An interpolated one is `null` rather than approximated:
 * a value the sweep cannot count is a value the cap does not bind.
 */
function staticText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null;
  if (ts.isJsxExpression(node)) return staticText(node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  return null;
}

function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.Expression | undefined {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && property.name.getText() === name) return property.initializer;
  }
  return undefined;
}

const bodyOf = (site: HintSite): ts.ObjectLiteralExpression | null => {
  const attribute = site.attributes.get("body");
  if (attribute === undefined || !ts.isJsxExpression(attribute)) return null;
  const expression = attribute.expression;

  return expression !== undefined && ts.isObjectLiteralExpression(expression) ? expression : null;
};

/** The bullets a `body` writes, each already joined into the one sentence it renders as. */
function pointsOf(body: ts.ObjectLiteralExpression): { readable: string[]; unreadable: number } {
  const points = propertyOf(body, "points");
  if (points === undefined) return { readable: [], unreadable: 0 };
  if (!ts.isArrayLiteralExpression(points)) return { readable: [], unreadable: 1 };

  const readable: string[] = [];
  let unreadable = 0;
  for (const element of points.elements) {
    if (!ts.isObjectLiteralExpression(element)) {
      unreadable += 1;
      continue;
    }
    const term = propertyOf(element, "term");
    const text = staticText(propertyOf(element, "text"));
    const termText = term === undefined ? "" : staticText(term);

    if (text === null || termText === null) unreadable += 1;
    else readable.push(termText === "" ? text : `${termText} ${text}`);
  }

  return { readable, unreadable };
}

const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The text a JSX subtree renders, or `null` where a value the sweep cannot read stands anywhere in it. */
function jsxText(node: ts.JsxChild): string | null {
  if (ts.isJsxText(node)) return node.text;
  if (ts.isJsxExpression(node)) return node.expression === undefined ? "" : staticText(node.expression);
  if (ts.isJsxSelfClosingElement(node)) return "";
  if (!ts.isJsxElement(node) && !ts.isJsxFragment(node)) return null;

  let joined = "";
  for (const child of node.children) {
    const part = jsxText(child);
    if (part === null) return null;
    joined += part;
  }
  return joined;
}

/**
 * The blocks an `InfoHint`'s children render as: one per element and one per `<li>`, the lead-and-bullets shape
 * `Hint`'s `body` declares. Adjacent bare children join, an unwrapped hint rendering as one run.
 */
function blocksOf(children: readonly ts.JsxChild[]): { readable: string[]; unreadable: number } {
  const readable: string[] = [];
  let unreadable = 0;
  let run: (string | null)[] = [];

  const push = (text: string | null): void => {
    if (text === null) unreadable += 1;
    else if (collapse(text) !== "") readable.push(collapse(text));
  };

  const closeRun = (): void => {
    if (run.length === 0) return;
    const parts = run;
    run = [];
    push(parts.includes(null) ? null : parts.join(""));
  };

  for (const child of children) {
    if (ts.isJsxElement(child) && child.openingElement.tagName.getText() === "ul") {
      closeRun();
      for (const item of child.children) if (ts.isJsxElement(item)) push(jsxText(item));
      continue;
    }
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      closeRun();
      push(jsxText(child));
      continue;
    }
    if (ts.isJsxText(child) && child.containsOnlyTriviaWhiteSpaces) continue;
    run.push(jsxText(child));
  }
  closeRun();

  return { readable, unreadable };
}

/** Sentence-ending punctuation that is not an abbreviation's and not the string's own last mark. */
function sentenceBreaks(sentence: string): number {
  let stripped = sentence;
  for (const abbreviation of ABBREVIATIONS) stripped = stripped.split(abbreviation).join("");
  // Quotes bound no sentence, and dropping them first lets one rule cover a mark inside a quoted label
  // as well as one outside it.
  const body = stripped.replace(/[„“”"»«]/g, "").replace(/[.!?]\s*$/, "");

  // A period ends a sentence only before a capital, German capitalising every sentence's first word.
  // What that admits is the ordinal in a rendered label like `Sieger 25.`, which no list can enumerate.
  return (body.match(/\.\s+\p{Lu}/gu) ?? []).length + (body.match(/[!?]/g) ?? []).length;
}

/**
 * Whether one `aria-describedby` in this file names `token`. A window rather than a parse: the
 * attribute takes a conditional as often as a bare value, and either way the id sits inside it.
 */
function describedByReaches(text: string, token: string): boolean {
  const ATTRIBUTE = "aria-describedby";
  for (let at = text.indexOf(ATTRIBUTE); at !== -1; at = text.indexOf(ATTRIBUTE, at + 1)) {
    if (text.slice(at, at + ATTRIBUTE.length + 200).includes(token)) return true;
  }
  return false;
}

const reveals = sites.filter((site) => site.tag === "Hint" && staticText(site.attributes.get("mode")) === "reveal");
const inlines = sites.filter((site) => site.tag === "Hint" && staticText(site.attributes.get("mode")) === "inline");
const panels = sites.filter((site) => site.tag === "InfoHint");

/**
 * Blocks holding only a rendered value, whose panel is a renderer rather than authored prose. The ceiling only ever
 * comes down: a new one is a hint written where the sweep cannot reach it.
 */
const UNMEASURABLE_BLOCK_CEILING = 10;

/**
 * The cap, over whatever mechanism wrote it. It exists to make an author say LESS: where compressing a
 * sentence would make it false, what goes is the content needing that density, never the cap.
 */
function assertCap(written: readonly string[]): void {
  const blocks = Math.max(written.length - 1, 0);
  assert.ok(blocks <= HINT_POINT_CAP, `${String(blocks)} blocks after the lead — the cap is ${String(HINT_POINT_CAP)}`);

  const length = written.reduce((sum, sentence) => sum + sentence.length, 0);
  assert.ok(length <= HINT_CHAR_CAP, `${String(length)} characters — the cap is ${String(HINT_CHAR_CAP)}. Say less, or move it.`);

  for (const sentence of written) {
    assert.equal(sentenceBreaks(sentence), 0, `two sentences where one was allowed: "${sentence}"`);
  }
}

/**
 * The prose the JSX sweep cannot see: each table holds whole hints that render through one
 * interpolated element. Read as source, never imported: ESLint's layer boundary forbids `shared`
 * a `features` import.
 */
const DATA_TABLES = [
  { file: "features/admin/constants.ts", constant: "ADMIN_SIDEMENU_STRUCTURE", shape: "sidemenu", floor: 4 },
  { file: "features/dashboard/constants.ts", constant: "DASHBOARD_SIDEMENU_STRUCTURE", shape: "sidemenu", floor: 4 },
  { file: "features/admin/utils.ts", constant: "ACTION_REQUIRED_LABELS", shape: "triage", floor: 4 },
  // A shell fallback holds the one hint for the route its navigation does not name, so its floor is that one hint.
  { file: "features/admin/constants.ts", constant: "ADMIN_SHELL_FALLBACK", shape: "fallback", floor: 1 },
  { file: "features/dashboard/constants.ts", constant: "DASHBOARD_SHELL_FALLBACK", shape: "fallback", floor: 1 },
] as const;

/** One table entry's hint, flattened into the blocks it renders as, the lead first. */
type DataHint = { constant: string; key: string; blocks: readonly (string | null)[] };

function parseModule(relative: string): ts.SourceFile {
  const full = path.join(SRC_DIR, ...relative.split("/"));

  return ts.createSourceFile(relative, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** The literal a top-level `const` holds, past any `as const satisfies …` wrapping it. */
function constantIn(source: ts.SourceFile, name: string): ts.Expression | null {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (declaration.name.getText(source) !== name || declaration.initializer === undefined) continue;

      let expression: ts.Expression = declaration.initializer;
      while (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) expression = expression.expression;

      return expression;
    }
  }

  return null;
}

/** The one line a `points` entry renders as, its term bold and its detail not. */
function pointLine(point: ts.Expression): string | null {
  if (!ts.isObjectLiteralExpression(point)) return null;
  const term = staticText(propertyOf(point, "term"));
  const detail = staticText(propertyOf(point, "detail"));

  return term === null || detail === null ? null : `${term} ${detail}`;
}

/** A `SidemenuHint`'s blocks: the lead, then each point as its rendered line, then the note. */
function hintBlocks(hint: ts.ObjectLiteralExpression): (string | null)[] {
  const points = propertyOf(hint, "points");
  const note = propertyOf(hint, "note");

  return [
    staticText(propertyOf(hint, "lead")),
    ...(points === undefined ? [] : ts.isArrayLiteralExpression(points) ? points.elements.map(pointLine) : [null]),
    ...(note === undefined ? [] : [staticText(note)]),
  ];
}

/** Every `hint` a sidemenu structure declares, named by the route id that owns it. */
function sidemenuHintsIn(declared: ts.Expression, constant: string): DataHint[] {
  if (!ts.isArrayLiteralExpression(declared)) return [];

  const hints: DataHint[] = [];
  for (const entry of declared.elements) {
    if (!ts.isObjectLiteralExpression(entry)) continue;
    const options = propertyOf(entry, "sub_options");
    if (options === undefined || !ts.isArrayLiteralExpression(options)) continue;

    for (const option of options.elements) {
      if (!ts.isObjectLiteralExpression(option)) continue;
      const hint = propertyOf(option, "hint");
      if (hint === undefined || !ts.isObjectLiteralExpression(hint)) continue;

      hints.push({ constant, key: staticText(propertyOf(option, "id")) ?? "unnamed", blocks: hintBlocks(hint) });
    }
  }

  return hints;
}

/** A shell fallback's one hint, named by the bar title it is shown under. */
function fallbackHintsIn(declared: ts.Expression, constant: string): DataHint[] {
  if (!ts.isObjectLiteralExpression(declared)) return [];
  const hint = propertyOf(declared, "hint");
  if (hint === undefined || !ts.isObjectLiteralExpression(hint)) return [];

  return [{ constant, key: staticText(propertyOf(declared, "label")) ?? "unnamed", blocks: hintBlocks(hint) }];
}

/**
 * A triage category's panel, which `AdminSpieleActionRequiredView` renders as its `name` over its
 * `desc` — the same lead-and-block shape a `SidemenuHint` writes, so the same cap counts it.
 */
function triageHintsIn(declared: ts.Expression, constant: string): DataHint[] {
  if (!ts.isObjectLiteralExpression(declared)) return [];

  const hints: DataHint[] = [];
  for (const category of declared.properties) {
    if (!ts.isPropertyAssignment(category) || !ts.isObjectLiteralExpression(category.initializer)) continue;

    hints.push({
      constant,
      key: category.name.getText(),
      blocks: [staticText(propertyOf(category.initializer, "name")), staticText(propertyOf(category.initializer, "desc"))],
    });
  }

  return hints;
}

/** Keyed by `shape`, so a table declaring one the sweep cannot read is a compile error rather than an empty result. */
const READER_FOR = { sidemenu: sidemenuHintsIn, triage: triageHintsIn, fallback: fallbackHintsIn };

const dataTables = DATA_TABLES.map((table) => {
  const declared = constantIn(parseModule(table.file), table.constant);
  const hints = declared === null ? [] : READER_FOR[table.shape](declared, table.constant);

  return { ...table, hints };
});

describe("what a hint is allowed to say", () => {
  it("found hints to measure at all", () => {
    // A floor, not a count: a rename that silently matched nothing would leave every case below
    // vacuously true.
    assert.ok(sources.size >= 100, `expected at least 100 components to sweep, found ${String(sources.size)}`);
    assert.ok(reveals.length >= 3, `expected at least 3 revealed hints, found ${String(reveals.length)}`);
    // The panel floor is the renderers under `shared/`, which render a value and so can never become a `Hint`.
    // An authored panel converts away over time, so a floor tracking today's count would fail on its own success.
    assert.ok(panels.length >= 4, `expected at least 4 hint panels, found ${String(panels.length)}`);
  });

  it("found the data tables to measure at all", () => {
    // Per table, so a rename that emptied one could not hide behind the others still reading.
    for (const table of dataTables) {
      assert.ok(
        table.hints.length >= table.floor,
        `${table.constant} yielded ${String(table.hints.length)} hints against a floor of ${String(table.floor)} — the sweep no longer reads it`,
      );
    }
  });

  it("adds no panel block the cap cannot reach", () => {
    const unmeasurable = panels.reduce((sum, site) => sum + blocksOf(site.children).unreadable, 0);

    assert.ok(
      unmeasurable <= UNMEASURABLE_BLOCK_CEILING,
      `${String(unmeasurable)} panel blocks render a value the cap cannot count, against a ceiling of ${String(UNMEASURABLE_BLOCK_CEILING)}`,
    );
  });

  for (const site of reveals) {
    it(`${site.file}:${String(site.line)} keeps the lead-and-four-bullets cap`, () => {
      const body = bodyOf(site);
      assert.ok(body !== null, "a revealed hint writes its body as an object literal, so the cap can be counted");

      const lead = staticText(propertyOf(body, "lead"));
      assert.ok(lead !== null, "the lead is a plain string, so the cap can be counted");

      const { readable, unreadable } = pointsOf(body);
      assert.equal(unreadable, 0, `${String(unreadable)} bullet(s) are not plain strings, so the cap cannot be counted`);

      assertCap([lead, ...readable]);
    });
  }

  for (const site of panels) {
    it(`${site.file}:${String(site.line)} keeps the cap in its own panel`, () => {
      assertCap(blocksOf(site.children).readable);
    });
  }

  for (const hint of dataTables.flatMap((table) => table.hints)) {
    it(`${hint.constant} :: ${hint.key} keeps the cap in its own table`, () => {
      const unreadable = hint.blocks.filter((block) => block === null).length;
      assert.equal(unreadable, 0, `${String(unreadable)} block(s) are not plain strings, so the cap cannot be counted`);

      assertCap(hint.blocks.filter((block): block is string => block !== null));
    });
  }

  for (const site of inlines) {
    it(`${site.file}:${String(site.line)} is pointed at by the control it explains`, () => {
      const attribute = site.attributes.get("describes");
      const literal = staticText(attribute);
      const token =
        literal ??
        (attribute !== undefined && ts.isJsxExpression(attribute) && attribute.expression !== undefined
          ? attribute.expression.getText()
          : null);

      assert.ok(token !== null, "an inline hint names the id it publishes");

      assert.ok(
        describedByReaches(sources.get(site.file) ?? "", token),
        `nothing in ${site.file} carries aria-describedby for ${token}, so the hint describes nothing`,
      );
    });
  }
});
