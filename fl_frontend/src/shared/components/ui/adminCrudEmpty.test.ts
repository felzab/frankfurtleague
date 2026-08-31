import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");
const FEATURES = path.join(SRC, "features");

/**
 * The Aktionen column, by the most controls ONE row can hold: 40 each with `gap-2` between, inside a
 * `px-6` cell, at the spacing step above that sum. Below three the „Aktionen“ heading is wider and
 * decides it instead.
 */
const ACTIONS_WIDTH: Record<number, string> = { 1: "w-32", 2: "w-36", 3: "w-48", 4: "w-60", 5: "w-72", 6: "w-84" };

/**
 * Every admin CRUD list whose empty message sits inside a react-aria table; the markup was
 * byte-identical in all of them, which let it drift out of one unnoticed. `alternates` never show
 * together; `freeText` is owed PER undeclared column, not per table.
 */
const TABLES = [
  { file: "features/aktionen/components/collections/AdminAktionenTable.tsx", controls: 2, alternates: 0, freeText: 224 },
  { file: "features/bewerbungen/components/collections/AdminBewerbungenTable.tsx", controls: 1, alternates: 0, freeText: 256 },
  { file: "features/teams/components/collections/AdminKontakteTable.tsx", controls: 2, alternates: 0, freeText: 256 },
  { file: "features/saisons/components/collections/AdminSaisonsTable.tsx", controls: 3, alternates: 0, freeText: 304 },
  { file: "features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx", controls: 4, alternates: 1, freeText: 176 },
  { file: "features/spieler/components/collections/AdminSpielerTable.tsx", controls: 4, alternates: 1, freeText: 176 },
  { file: "features/spielorte/components/collections/AdminSpielorteTable.tsx", controls: 5, alternates: 1, freeText: 224 },
  { file: "features/teams/components/collections/AdminTeamsTable.tsx", controls: 6, alternates: 1, freeText: 256 },
];

const read = (file: string): string => readFileSync(path.join(SRC, file), "utf8");

/** Every `.tsx` under `src/features`, so a table added in a slice this roster has never heard of is still found. */
function tsxUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxUnder(full);
    return entry.name.endsWith(".tsx") ? [path.relative(SRC, full).split(path.sep).join("/")] : [];
  });
}

/** Each `@theme` block's body. Tailwind takes a theme variable from nowhere else, so nor does this. */
function themeBlocks(css: string): string[] {
  return [...css.matchAll(/@theme[^{]*\{/g)].map((opened) => {
    let depth = 1;
    let index = opened.index + opened[0].length;
    while (depth > 0 && index < css.length) depth += css[index++] === "{" ? 1 : css[index - 1] === "}" ? -1 : 0;

    return css.slice(opened.index + opened[0].length, index - 1);
  });
}

/**
 * The theme the app compiles against, read off the stylesheets rather than off a table written here.
 * Tailwind's own defaults first, then whatever `globals.css` redeclares over them.
 */
const THEME = new Map<string, string>();
for (const sheet of [path.join(SRC, "..", "node_modules", "tailwindcss", "theme.css"), path.join(SRC, "app", "globals.css")]) {
  for (const block of themeBlocks(readFileSync(sheet, "utf8")))
    for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) THEME.set(name!, value!.trim());
}

/** The root element declares no `font-size`, so a rem here is the browser's own. */
const REM = 16;

function px(value: string | undefined): number | null {
  const measure = /^(-?\d+(?:\.\d+)?)(rem|px)$/.exec(value ?? "");
  if (measure === null) return null;
  return Number(measure[1]) * (measure[2] === "rem" ? REM : 1);
}

/**
 * `w-44` and `min-w-5xl` in pixels. Both scales come from the theme: a numeric step is a multiple of
 * `--spacing`, and a named one is the `--container-*` of that name.
 */
function widthPx(token: string): number | null {
  const step = /^(?:min-)?w-(\d+(?:\.\d+)?)$/.exec(token);
  if (step !== null) {
    const spacing = px(THEME.get("spacing"));
    return spacing === null ? null : Number(step[1]) * spacing;
  }

  const named = /^(?:min-)?w-([a-z0-9]+)$/.exec(token);
  return named === null ? null : px(THEME.get(`container-${named[1]!}`));
}

type Element = { tag: string; classes: readonly string[]; start: number; end: number };

/** A template's own text counts, so a width written beside an interpolation is still declared. */
function classesOf(opening: ts.JsxOpeningLikeElement, source: ts.SourceFile): string[] {
  for (const attribute of opening.attributes.properties) {
    if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== "className") continue;

    const declared = attribute.initializer;
    let written: string | null = null;

    if (declared !== undefined && ts.isStringLiteral(declared)) written = declared.text;
    else if (declared !== undefined && ts.isJsxExpression(declared) && declared.expression !== undefined) {
      const expression = declared.expression;
      if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) written = expression.text;
      else if (ts.isTemplateExpression(expression))
        written = [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(" ");
    }

    return written === null ? [] : written.split(/\s+/).filter((token) => token !== "");
  }

  return [];
}

/* Parsed rather than matched as text: the Prettier plugin owns the order inside a class attribute, and
   a guard reading one as a string is the brittleness that already bit this file once. */
function elementsOf(file: string): Element[] {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: Element[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      found.push({
        tag: opening.tagName.getText(source),
        classes: classesOf(opening, source),
        start: node.getStart(source),
        end: node.getEnd(),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** The one `Table.Content` and the columns declared inside it, which is what fixed layout allocates over. */
function tableOf(file: string): { content: Element | null; columns: Element[] } {
  const elements = elementsOf(file);
  const contents = elements.filter((element) => element.tag === "Table.Content");
  const content = contents.length === 1 ? contents[0]! : null;

  return {
    content,
    columns:
      content === null
        ? []
        : elements.filter((element) => element.tag === "Table.Column" && element.start >= content.start && element.end <= content.end),
  };
}

const widthToken = (element: Element): string | undefined => element.classes.find((token) => /^w-/.test(token));

describe("the eight admin CRUD tables", () => {
  /* Read off the tree rather than off the roster's own length, which only a hand edit two lines above
     it could ever move: the drift worth catching is a ninth table added in some other slice. */
  it("are every collection in the tree that pairs the shared emptiness with a react-aria table", () => {
    const found = tsxUnder(FEATURES).filter((file) => {
      const source = read(file);
      return source.includes("CrudEmptiness") && source.includes("<Table.Content");
    });

    assert.deepEqual(found.sort(), TABLES.map(({ file }) => file).sort());
  });

  /* One row tall is a height the empty `<td>` has to build itself, and a list spelling its own box
     builds a different one — which is how the tall centred panel survived in five copies. */
  it("draw the shared empty row and the shared empty card rather than spelling their own", () => {
    for (const { file } of TABLES) {
      const source = read(file);

      assert.match(source, /renderEmptyState=\{\(\) => <AdminCrudEmptyRow /, `${file}: spells its own empty row`);
      assert.match(source, /<AdminCrudEmptyCard /, `${file}: spells its own empty card below md`);
      assert.doesNotMatch(source, /const emptyState =/, `${file}: keeps a local empty state beside the shared one`);
    }
  });

  /* React-aria writes the empty state as ONE `<td colSpan>`, which sizes no column: under auto
     layout the columns collapse the moment the rows go. A declared width is then an allocation. */
  it("lay their columns out fixed, over a minimum the declared ones cannot exhaust", () => {
    for (const { file, freeText } of TABLES) {
      const { content, columns } = tableOf(file);

      assert.ok(content !== null, `${file}: expected exactly one Table.Content`);
      assert.ok(content.classes.includes("table-fixed"), `${file}: leaves its columns to auto layout`);
      assert.ok(columns.length > 0, `${file}: declares no columns the guard can read`);

      const floors = content.classes.filter((token) => token.startsWith("min-w-"));
      assert.equal(floors.length, 1, `${file}: names ${String(floors.length)} floors for its free-text columns`);

      const declared = columns.map(widthToken).filter((token) => token !== undefined);
      const widths = declared.map((token) => widthPx(token));
      assert.ok(
        !widths.includes(null),
        `${file}: declares ${declared.join(" ")}, and the theme resolves none of ${declared.filter((_token, index) => widths[index] === null).join(" ")}`,
      );

      const owed = widths.reduce<number>((sum, width) => sum + width!, 0) + freeText * (columns.length - declared.length);
      assert.equal(
        widthPx(floors[0]!),
        owed,
        `${file}: ${floors[0]!} is not the ${String(owed)}px its ${String(declared.length)} declared columns plus ${String(columns.length - declared.length)} free-text one(s) come to`,
      );
    }
  });

  /* A control added to a row that already fills its column wraps the widest row onto a second line,
     and nothing else reports it: fixed layout will not widen the column to take the new control. */
  it("size the Aktionen column from the controls a row can hold", () => {
    for (const { file, controls, alternates } of TABLES) {
      const declared = read(file).match(/<RowAction(?:Link|Copy|Restore|Delete)\b/g)?.length ?? 0;
      assert.equal(declared, controls + alternates, `${file}: holds a control the roster here does not count`);

      // The only column ended right, which is what makes it the Aktionen one.
      const ended = tableOf(file).columns.filter((column) => column.classes.includes("text-right"));
      assert.equal(ended.length, 1, `${file}: expected one right-ended column, found ${String(ended.length)}`);
      assert.equal(
        widthToken(ended[0]!),
        ACTIONS_WIDTH[controls],
        `${file}: its Aktionen column is not the width ${String(controls)} controls need`,
      );
    }
  });
});
