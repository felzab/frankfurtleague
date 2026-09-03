import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

const VIEW = "AdminBracketWiringView.tsx";

/**
 * The view as written and not as rendered: a recipe call and its expansion render alike. Parsed
 * rather than matched as text, so an assertion here survives the view being reformatted; what the
 * parse cannot reach is left unpinned.
 */
const text = readFileSync(path.resolve(import.meta.dirname, VIEW), "utf8");
const source = ts.createSourceFile(VIEW, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

type Element = {
  tag: string;
  /** An interpolated call contributes none, so a class it hides is unpinned rather than assumed absent. */
  classes: readonly string[];
  /** The className attribute's own source, which is where a recipe call shows and `classes` cannot. */
  classSource: string;
  role: string | null;
  /** Whether it is taken out of the accessibility tree, however the attribute spells it. */
  isHidden: boolean;
  /** Its whole source, which is what tells one cell of a row from another. */
  body: string;
  /** Its DIRECT children's source, which is what tells the element carrying a string from the box around it. */
  own: string;
  /** Where it sits in the file, which is what places one element inside another. */
  start: number;
  end: number;
};

/** A span of the file an element can sit inside. */
type Range = { start: number; end: number };

function attributeNode(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === name) return attribute;
  }

  return undefined;
}

function attributeOf(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttributeValue | undefined {
  return attributeNode(opening, name)?.initializer;
}

/** A bare `aria-hidden` is `true`, and `aria-hidden="false"` leaves the element in the tree, so neither is read as its presence. */
function isHiddenFrom(opening: ts.JsxOpeningLikeElement): boolean {
  const declared = attributeNode(opening, "aria-hidden");
  if (declared === undefined) return false;

  const value = declared.initializer;
  if (value === undefined) return true;
  if (ts.isStringLiteral(value)) return value.text !== "false";
  if (ts.isJsxExpression(value) && value.expression !== undefined) return value.expression.kind !== ts.SyntaxKind.FalseKeyword;

  return true;
}

/** A template's own text counts: an `align-top` written beside an interpolation is still declared. */
function classesOf(opening: ts.JsxOpeningLikeElement): string[] {
  const declared = attributeOf(opening, "className");
  let written: string | null = null;

  if (declared !== undefined && ts.isStringLiteral(declared)) written = declared.text;
  else if (declared !== undefined && ts.isJsxExpression(declared) && declared.expression !== undefined) {
    const expression = declared.expression;

    if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) written = expression.text;
    else if (ts.isTemplateExpression(expression)) {
      written = [expression.head.text, ...expression.templateSpans.map((span) => span.literal.text)].join(" ");
    }
  }

  return written === null ? [] : written.split(/\s+/).filter((token) => token !== "");
}

function staticAttribute(opening: ts.JsxOpeningLikeElement, name: string): string | null {
  const declared = attributeOf(opening, name);

  return declared !== undefined && ts.isStringLiteral(declared) ? declared.text : null;
}

const elements: Element[] = [];
const calls: string[] = [];
const constructed: string[] = [];
const visit = (node: ts.Node): void => {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;

    elements.push({
      tag: opening.tagName.getText(source),
      classes: classesOf(opening),
      classSource: attributeOf(opening, "className")?.getText(source) ?? "",
      role: staticAttribute(opening, "role"),
      isHidden: isHiddenFrom(opening),
      body: node.getText(source),
      own: ts.isJsxElement(node) ? node.children.map((child) => child.getText(source)).join("") : "",
      start: node.getStart(source),
      end: node.getEnd(),
    });
  }
  if (ts.isCallExpression(node)) calls.push(node.expression.getText(source));
  if (ts.isNewExpression(node) && node.expression.getText(source) === "Map") constructed.push(node.getText(source));
  ts.forEachChild(node, visit);
};
visit(source);

const tags = new Set(elements.map((element) => element.tag));
const taggedAs = (tag: string): Element[] => elements.filter((element) => element.tag === tag);
/** Whitespace-free, so a prettier reflow of a child expression does not move the element it belongs to. */
const carries = (element: Element, child: string): boolean => element.own.replace(/\s+/g, "") === child;

function namedImportsFrom(module: string): Set<string> {
  const names = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== module) continue;

    const bindings = statement.importClause?.namedBindings;
    if (bindings !== undefined && ts.isNamedImports(bindings)) for (const binding of bindings.elements) names.add(binding.name.getText(source));
  }

  return names;
}

/** The record a top-level `const` holds, or `null` where it is no longer one the guard can read. */
function objectConstant(name: string): ts.ObjectLiteralExpression | null {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;

    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (declaration.name.getText(source) !== name || initializer === undefined) continue;

      return ts.isObjectLiteralExpression(initializer) ? initializer : null;
    }
  }

  return null;
}

/** The span a top-level function declaration covers, or `null` where it is no longer one the guard can place. */
function rangeOfFunction(name: string): Range | null {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.getText(source) === name)
      return { start: statement.getStart(source), end: statement.getEnd() };
  }

  return null;
}

/** `SlotWiring` is declared at top level and drawn nowhere but the pair cell, so what it renders lands in that cell. */
const inside = (element: Element, ranges: readonly (Range | null)[]): boolean =>
  ranges.some((range) => range !== null && element.start >= range.start && element.end <= range.end);

/** What a function destructures out of its one props object, empty where it takes none the guard can read. */
function propsOf(name: string): string[] {
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name?.getText(source) !== name) continue;

    const binding = statement.parameters[0]?.name;
    if (binding === undefined || !ts.isObjectBindingPattern(binding)) return [];

    return binding.elements.map((element) => element.name.getText(source));
  }

  return [];
}

describe("the bracket wiring review", () => {
  /* First, and a floor rather than a count: a view that stopped parsing, or stopped rendering
     anything at all, would leave every case below vacuously true. */
  it("parses into elements the cases below can read", () => {
    assert.ok(elements.length >= 15, `${VIEW}: only ${String(elements.length)} elements parsed`);
    assert.ok(text.includes("export function AdminBracketWiringView"), `${VIEW}: the view is no longer exported from here`);
  });

  /* The fact under review is the edge, and a match card drops the provenance the moment a winner
     arrives. `.claude/rules/frontend.md` carries it as "render its wiring as cards". */
  it("draws the fixtures as table rows, and nothing here as a card", () => {
    assert.ok(namedImportsFrom("@heroui/react").has("Table"), `${VIEW}: HeroUI's Table is no longer imported`);
    assert.ok(tags.has("Table.Row"), `${VIEW}: a fixture is no longer a table row`);

    const cards = [...tags].filter((tag) => tag.endsWith("Card"));
    assert.deepEqual(cards, [], `${VIEW}: renders ${cards.join(", ")}`);

    /* The recipe and not only the component name: a slot or a row rebuilt as `<div className={card()}>`
       is the same decision, and the round panel around the table is the one card this view owes. */
    const wiring = [taggedAs("Table.Content")[0] ?? null, rangeOfFunction("SlotWiring")];
    const recipes = elements.filter((element) => /\bcard\(/.test(element.classSource) && inside(element, wiring));

    assert.deepEqual(
      recipes.map((element) => element.tag),
      [],
      `${VIEW}: ${recipes.map((element) => element.tag).join(", ")} inside the fixtures wears the card recipe`,
    );
  });

  /* Auto layout reads a declared width as a preference, so the longest club name in the pair column
     pushes the number and the action columns off the widths they declare. */
  it("lays its columns out fixed, so the two narrow ones hold", () => {
    const contents = taggedAs("Table.Content");

    assert.equal(contents.length, 1, `${VIEW}: expected one Table.Content, found ${String(contents.length)}`);
    assert.ok(contents[0]?.classes.includes("table-fixed"), `${VIEW}: the table leaves its columns to auto layout`);
  });

  /* `.cards-cascade [role="listitem"]` in `fl_frontend/src/app/globals.css` is a DESCENDANT selector,
     so a second one anywhere inside a round panel takes the card entrance as well. */
  it("marks one list item per round and none below it", () => {
    const items = elements.filter((element) => element.role === "listitem");

    assert.equal(items.length, 1, `${VIEW}: ${String(items.length)} elements carry role="listitem", and the cascade animates each of them`);
  });

  /* Four states, four fills, so a chip answers "does this need me?" first. Flattened to one value the
     panel reads as one colour; flattened to bare ink it stops being a chip. */
  it("keeps the four origin tints four distinct fill-and-ink pairs", () => {
    const record = objectConstant("HERKUNFT_TINTS");
    assert.ok(record !== null, `${VIEW}: HERKUNFT_TINTS is no longer a record the guard can read`);

    const tints = new Map<string, string>();
    for (const property of record.properties) {
      if (ts.isPropertyAssignment(property)) tints.set(property.name.getText(source), property.initializer.getText(source));
    }

    assert.deepEqual(
      [...tints.keys()].sort(),
      ["gruppe", "manuell", "offen", "spiel"],
      `${VIEW}: HERKUNFT_TINTS no longer names the four origins`,
    );
    assert.equal(
      new Set(tints.values()).size,
      4,
      `${VIEW}: the origins no longer read apart — ${[...tints].map(([origin, tint]) => `${origin}: ${tint}`).join(", ")}`,
    );

    for (const [origin, tint] of tints) {
      // A borrow from `PHASE_TINTS` is a pair by construction, that map's own home carrying the grade.
      if (tint.startsWith("PHASE_TINTS.")) continue;

      const tokens = tint.split(/\s+/);
      assert.ok(
        tokens.some((token) => token.includes("bg-")) && tokens.some((token) => token.includes("text-")),
        `${VIEW}: the ${origin} origin is ${tint}, which paints no chip`,
      );
    }
  });

  /* A Chip's `color` resolves against HeroUI's own tokens, which this app maps none of, and a Tag
     renders unstyled — `tag.css` is imported nowhere. Both compile, lint and build. */
  it("paints the origin with the app's label pill and a class string", () => {
    assert.ok(namedImportsFrom("@/shared/components/ui/badges").has("LABEL_BADGE"), `${VIEW}: the origin no longer wears the app's label pill`);
    assert.ok(namedImportsFrom("@/features/saisons/constants").has("PHASE_TINTS"), `${VIEW}: the phase palette is no longer read here`);

    const vendored = [...tags].filter((tag) => tag === "Chip" || tag === "Tag");
    assert.deepEqual(vendored, [], `${VIEW}: renders HeroUI's ${vendored.join(", ")}`);
  });

  /* The chip names the round a slot is fed FROM, not the round it stands in, so the panel's own
     phase must never be what colours it — one round can be fed by two. */
  it("colours a slot from the phase of the fixture feeding it", () => {
    assert.ok(propsOf("SlotWiring").includes("phaseBySpielNr"), `${VIEW}: a slot is no longer told which phase each fixture number sits in`);

    const index = constructed.filter((expression) => expression.includes("spiel_nr") && expression.includes("saison_phase"));
    assert.equal(index.length, 1, `${VIEW}: expected one fixture-number to phase index, found ${String(index.length)}`);
  });

  /* A visible seat digit sits one space from an origin opening on its own ordinal, so "1" and "1. der
     Gruppe A" read as one doubled number. The chips and the order carry the seat on sight. */
  it("names each seat once, and only where it cannot be seen", () => {
    const named = calls.filter((callee) => callee === "sideLabel");
    assert.equal(named.length, 1, `${VIEW}: ${String(named.length)} seat labels are spelled, and a slot draws one seat`);

    const carriers = elements.filter((element) => carries(element, "{sideLabel(side)}"));
    assert.equal(carriers.length, 1, `${VIEW}: expected one element carrying the seat name, found ${String(carriers.length)}`);
    assert.ok(carriers[0]?.classes.includes("sr-only"), `${VIEW}: the seat name is drawn, and it reads as a second number beside the origin`);
  });

  /* The heading states the phase, and states it with an ordinal a phase chip drops, so a chip beside
     it repeats one fact and loses another. */
  it("heads a round with the matchday label alone", () => {
    const headings = taggedAs("h2");

    assert.equal(headings.length, 1, `${VIEW}: expected one round heading, found ${String(headings.length)}`);
    assert.ok(!text.includes("SaisonPhaseChip"), `${VIEW}: a phase chip stands beside the round heading`);
  });

  describe("a fixture's row", () => {
    const cells = taggedAs("Table.Cell");
    const pairCell = cells.filter((cell) => cell.body.includes("SlotWiring"));
    const actionCell = cells.filter((cell) => cell.body.includes("adminSpielEditHref"));
    const numberCell = cells.filter((cell) => !cell.body.includes("SlotWiring") && !cell.body.includes("adminSpielEditHref"));

    /* Before the cases under it, which read all three: a row the guard cannot take apart would report
       the alignment of nothing. */
    it("is three cells the guard can tell apart", () => {
      assert.equal(cells.length, 3, `${VIEW}: expected three cells in a row, found ${String(cells.length)}`);
      assert.equal(pairCell.length, 1, `${VIEW}: expected one cell drawing SlotWiring, found ${String(pairCell.length)}`);
      assert.equal(actionCell.length, 1, `${VIEW}: expected one cell linking into the editor, found ${String(actionCell.length)}`);
      assert.equal(numberCell.length, 1, `${VIEW}: expected one remaining cell, found ${String(numberCell.length)}`);
      assert.ok(numberCell[0]?.body.includes("spiel.spiel_nr"), `${VIEW}: the remaining cell is not the fixture number's`);
    });

    /* The shape the doubled number had: a marker drawn for the eye and hidden from the reading, one
       space from an origin that opens on an ordinal of its own. A childless one is decoration. */
    it("draws no reading in the pair cell that is hidden from assistive technology", () => {
      assert.ok(pairCell[0] !== undefined, `${VIEW}: no pair cell to read`);

      const slot = rangeOfFunction("SlotWiring");
      assert.ok(slot !== null, `${VIEW}: SlotWiring is no longer a declaration the guard can place`);

      const silenced = elements.filter(
        (element) => element.isHidden && element.own.trim() !== "" && inside(element, [pairCell[0] ?? null, slot]),
      );

      assert.deepEqual(
        silenced.map((element) => element.tag),
        [],
        `${VIEW}: ${silenced.map((element) => element.tag).join(", ")} in the pair cell draws what only the eye gets`,
      );
    });

    /* One cell declaring an alignment the other does not puts the control some sixty pixels above its
       own number on the worst phone row, and nothing else here catches it. */
    it("declares no vertical alignment on the number or the action, so both take the vendored middle", () => {
      for (const [which, cell] of [
        ["fixture-number", numberCell[0]],
        ["action", actionCell[0]],
      ] as const) {
        assert.ok(cell !== undefined, `${VIEW}: no ${which} cell to read`);

        const declared = cell.classes.filter((token) => /(^|:)align-/.test(token));
        assert.deepEqual(declared, [], `${VIEW}: the ${which} cell declares ${declared.join(" ")}, so it no longer sits level with the other`);
      }
    });
  });
});
