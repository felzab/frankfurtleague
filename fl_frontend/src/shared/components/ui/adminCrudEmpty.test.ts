import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

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
  // Two undeclared columns, the one row here that is two blocks of like weight, so `freeText` is
  // owed twice.
  { file: "features/aktionen/components/collections/AdminAktionenTable.tsx", controls: 2, alternates: 0, freeText: 240 },
  { file: "features/bewerbungen/components/collections/AdminBewerbungenTable.tsx", controls: 1, alternates: 0, freeText: 208 },
  { file: "features/saisons/components/collections/AdminSaisonsTable.tsx", controls: 2, alternates: 0, freeText: 224 },
  { file: "features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx", controls: 4, alternates: 1, freeText: 240 },
  { file: "features/spieler/components/collections/AdminSpielerTable.tsx", controls: 3, alternates: 1, freeText: 240 },
  { file: "features/spielorte/components/collections/AdminSpielorteTable.tsx", controls: 4, alternates: 1, freeText: 240 },
  { file: "features/teams/components/collections/AdminTeamsTable.tsx", controls: 3, alternates: 1, freeText: 336 },
];

const read = (file: string): string => readFileSync(path.join(SRC, file), "utf8");

/** Every shipped `.tsx` under `src/features`, so a table added in a slice this roster has never heard of is still found. */
const tsxUnder = (dir: string): string[] =>
  filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 100).map((full) => path.relative(SRC, full).split(path.sep).join("/"));

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
 * A theme variable in pixels, raising where the stylesheets declare none. A non-null assertion here
 * would be TypeScript's alone: at runtime `px` answers null, arithmetic reads that as zero, and the
 * ceiling below rises silently past every floor it guards.
 */
function themePx(name: string): number {
  const measured = px(THEME.get(name));
  if (measured === null) throw new Error(`the theme declares no --${name} this reader can measure`);

  return measured;
}

/**
 * `w-44` and `min-w-5xl` in pixels. Both scales come from the theme: a numeric step is a multiple of
 * `--spacing`, and a named one is the `--container-*` of that name.
 */
function widthPx(token: string): number | null {
  const step = /^(?:min-)?w-(\d+(?:\.\d+)?)$/.exec(token);
  if (step !== null) return Number(step[1]) * themePx("spacing");

  const named = /^(?:min-)?w-([a-z0-9]+)$/.exec(token);
  return named === null ? null : px(THEME.get(`container-${named[1]!}`));
}

/** `AdminCrudShell`'s `sm:p-8`, both sides. */
const SHELL_INSET = 2 * 8 * themePx("spacing");
/** `card()`'s `border`, one pixel each side. */
const CARD_BORDER = 2;
/**
 * The classic scrollbar `AppShell`'s `main` reserves through `scrollbar-gutter-stable`, at the widest
 * a shipped desktop browser draws one; a platform drawing overlay scrollbars reserves nothing.
 */
const SCROLLBAR = 17;

/**
 * The narrowest table any viewport gives: the `lg` step less the docked rail, against the `md` step
 * with the rail a drawer. **The wider breakpoint binds**, the rail taking its width out of the
 * content column from `lg` up.
 */
const STEP =
  Math.min(themePx("breakpoint-md") - SHELL_INSET, themePx("breakpoint-lg") - themePx("width-sidemenu") - SHELL_INSET) -
  CARD_BORDER -
  SCROLLBAR;

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

/**
 * The one `Table.Content`, the columns fixed layout allocates over, and the cells under them: a
 * column and its cells are two ways to write the same disappearance, and the grid feels both.
 */
function tableOf(file: string): { content: Element | null; columns: Element[]; cells: Element[] } {
  const elements = elementsOf(file);
  const contents = elements.filter((element) => element.tag === "Table.Content");
  const content = contents.length === 1 ? contents[0]! : null;
  const inside = (tag: string): Element[] =>
    content === null ? [] : elements.filter((element) => element.tag === tag && element.start >= content.start && element.end <= content.end);

  return { content, columns: inside("Table.Column"), cells: inside("Table.Cell") };
}

/** A utility's own name, every variant prefix stripped, so `max-lg:hidden` and `@2xl:min-w-40` both reach the test below. */
const utilityOf = (token: string): string => token.slice(token.lastIndexOf(":") + 1);

/**
 * A class that makes the element it sits on exist at one width and not another. A bare width is the
 * allocation fixed layout needs; the same width behind a variant is the allocation changing.
 */
function widthConditional(token: string): boolean {
  const utility = utilityOf(token);

  return utility === "hidden" || (utility !== token && /^(?:min-|max-)?w-/.test(utility));
}

const widthToken = (element: Element): string | undefined => element.classes.find((token) => /^w-/.test(token));

const TABLE_BOX = new Set(["Table", "Table.ScrollContainer", "Table.Content"]);

/** `w-full` and `max-w-full` are the box taking what it is given; `min-w-*` is the floor above. */
function selfCapped(token: string): boolean {
  const utility = utilityOf(token);

  return /^(?:max-)?w-/.test(utility) && utility !== "w-full" && utility !== "max-w-full";
}

describe("the seven admin CRUD tables", () => {
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
      const { content, columns, cells } = tableOf(file);

      assert.ok(content !== null, `${file}: expected exactly one Table.Content`);
      assert.ok(content.classes.includes("table-fixed"), `${file}: leaves its columns to auto layout`);
      assert.ok(columns.length > 0, `${file}: declares no columns the guard can read`);
      /* The row template writes one cell per column. Read here so the cell sweep below cannot go
         quiet on a renamed tag, which would leave it passing over an empty population. */
      assert.equal(cells.length, columns.length, `${file}: declares ${String(columns.length)} columns and ${String(cells.length)} cells`);

      const floors = content.classes.filter((token) => token.startsWith("min-w-"));
      assert.equal(floors.length, 1, `${file}: names ${String(floors.length)} floors for its free-text columns`);

      const declared = columns.map(widthToken).filter((token) => token !== undefined);
      const widths = declared.map((token) => widthPx(token));
      assert.ok(
        !widths.includes(null),
        `${file}: declares ${declared.join(" ")}, and the theme resolves none of ${declared.filter((_token, index) => widths[index] === null).join(" ")}`,
      );

      const free = columns.length - declared.length;
      assert.ok(free >= 1, `${file}: declares a width on every column, so the roster's allowance binds nothing`);

      /* `freeText` is declared, never measured: lower it and the floor together and the equality
         below still passes over an identity column too narrow for a name. Legibility at a width
         needs a browser and is asserted nowhere. */
      const widest = Math.max(...widths.map((width) => width!), 0);
      assert.ok(
        freeText >= widest,
        `${file}: allows its free-text column ${String(freeText)}px beside a bounded column of ${String(widest)}px — the identity block takes the remainder and is never the narrower`,
      );

      const owed = widths.reduce<number>((sum, width) => sum + width!, 0) + freeText * free;
      assert.equal(
        widthPx(floors[0]!),
        owed,
        `${file}: ${floors[0]!} is not the ${String(owed)}px its ${String(declared.length)} declared columns plus ${String(columns.length - declared.length)} free-text one(s) come to`,
      );

      // The floor the columns asked for, against the width a viewport can give: over the step the
      // scroll container below is reached at every width the table renders at, which is the one
      // outcome it is not there for.
      assert.ok(
        widthPx(floors[0]!)! <= STEP,
        `${file}: ${floors[0]!} is ${String(widthPx(floors[0]!))}px, over the ${String(STEP)}px the narrowest content column gives a table`,
      );

      /* A react-aria grid navigates its collection rather than the DOM, so `ArrowRight` hands the
         focused key to a `display:none` cell: one dead keypress per hidden column per row, and an
         `aria-colcount` over columns nothing can reach. */
      for (const element of [...columns, ...cells]) {
        const banned = element.classes.filter(widthConditional);
        assert.deepEqual(banned, [], `${file}: a ${element.tag} carrying ${banned.join(" ")} exists at one width and not another`);
      }
    }
  });

  /* The bar above the table takes `AdminCrudShell`'s whole capped column, and fixed layout hands the
     surplus to the one undeclared column. A table capping itself stops growing under a toolbar that
     does not. */
  it("take the shell's column whole, so the surplus above the floor reaches the undeclared column", () => {
    for (const { file } of TABLES) {
      // The desktop wrapper too: a cap there stops the table as surely as one on the table itself.
      const boxes = elementsOf(file).filter((element) => TABLE_BOX.has(element.tag) || element.classes.includes("md:block"));
      const tags = new Set(boxes.map((box) => box.tag));

      for (const tag of TABLE_BOX) assert.ok(tags.has(tag), `${file}: names no ${tag} for this sweep to read`);

      for (const box of boxes) {
        const capping = box.classes.filter(selfCapped);
        assert.deepEqual(
          capping,
          [],
          `${file}: its ${box.tag} carries ${capping.join(" ")} and stops short of the column the bar above it fills`,
        );
      }
    }
  });

  /* A control added to a row that already fills its column wraps the widest row onto a second line,
     and nothing else reports it: fixed layout will not widen the column to take the new control. */
  it("size the Aktionen column from the controls a row can hold", () => {
    for (const { file, controls, alternates } of TABLES) {
      const declared = read(file).match(/<RowAction(?:Link|Copy|Restore|Delete|Menu)\b/g)?.length ?? 0;
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

/* No table hides a column today, so a sweep over the tree alone cannot tell this reader from one
   that matches nothing. A variant spelling is caught here or nowhere. */
describe("the reader behind the hidden-column sweep", () => {
  it("takes a disappearance behind any variant prefix, and leaves an unconditional width alone", () => {
    for (const token of [
      "hidden",
      "lg:hidden",
      "max-lg:hidden",
      "not-lg:hidden",
      "@2xl:hidden",
      "md:hover:hidden",
      "md:w-40",
      "lg:min-w-40",
      "@max-md:max-w-40",
    ])
      assert.ok(widthConditional(token), `${token}: read as unconditional`);

    for (const token of ["w-24", "min-w-156", "max-w-full", "text-right", "table-fixed", "border-b"])
      assert.ok(!widthConditional(token), `${token}: read as conditional`);
  });
});

/* No admin table caps itself today, so the sweep over the tree cannot tell this reader from one that
   matches nothing. A cap written behind a variant is caught here or nowhere. */
describe("the reader behind the self-cap sweep", () => {
  it("takes a width that stops a box short, and leaves the two that take the column whole", () => {
    for (const token of ["max-w-page", "max-w-4xl", "max-w-[1400px]", "w-96", "lg:max-w-page", "@2xl:w-80"])
      assert.ok(selfCapped(token), `${token}: read as taking the column whole`);

    for (const token of ["w-full", "max-w-full", "min-w-156", "table-fixed", "hidden", "md:block", "h-fit", "p-0"])
      assert.ok(!selfCapped(token), `${token}: read as a cap`);
  });
});
