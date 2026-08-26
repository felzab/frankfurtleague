import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

const VIEW = "AdminBracketWiringView.tsx";

/**
 * Parsed rather than matched as text: there is no DOM harness here, and every decision below is one a
 * reformatting must stay free to move. What the parse cannot reach is left unpinned.
 */
const text = readFileSync(path.resolve(import.meta.dirname, VIEW), "utf8");
const source = ts.createSourceFile(VIEW, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

type Element = {
  tag: string;
  /** An interpolated call contributes none, so a class it hides is unpinned rather than assumed absent. */
  classes: readonly string[];
  role: string | null;
  /** Its whole source, which is what tells one cell of a row from another. */
  body: string;
};

function attributeOf(opening: ts.JsxOpeningLikeElement, name: string): ts.JsxAttributeValue | undefined {
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxAttribute(attribute) && attribute.name.getText(source) === name) return attribute.initializer;
  }

  return undefined;
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
const visit = (node: ts.Node): void => {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const opening = ts.isJsxElement(node) ? node.openingElement : node;

    elements.push({
      tag: opening.tagName.getText(source),
      classes: classesOf(opening),
      role: staticAttribute(opening, "role"),
      body: node.getText(source),
    });
  }
  ts.forEachChild(node, visit);
};
visit(source);

const tags = new Set(elements.map((element) => element.tag));
const taggedAs = (tag: string): Element[] => elements.filter((element) => element.tag === tag);

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

describe("the bracket wiring review", () => {
  /* First, and a floor rather than a count: a view that stopped parsing, or stopped rendering
     anything at all, would leave every case below vacuously true. */
  it("parses into elements the cases below can read", () => {
    assert.ok(elements.length >= 15, `${VIEW}: only ${String(elements.length)} elements parsed`);
    assert.ok(text.includes("export function AdminBracketWiringView"), `${VIEW}: the view is no longer exported from here`);
  });

  /* Decided 2026-08-07: the fact under review is the edge, and a match card drops the provenance the
     moment a winner arrives. CLAUDE.md §7 carries it as "render its wiring as cards". */
  it("draws the fixtures as table rows, and nothing here as a card", () => {
    assert.ok(namedImportsFrom("@heroui/react").has("Table"), `${VIEW}: HeroUI's Table is no longer imported`);
    assert.ok(tags.has("Table.Row"), `${VIEW}: a fixture is no longer a table row`);

    const cards = [...tags].filter((tag) => tag.endsWith("Card"));
    assert.deepEqual(cards, [], `${VIEW}: renders ${cards.join(", ")}`);
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

  /* Decided 2026-08-07 and re-argued 2026-08-26: four states, four colours, so the ink answers
     "does this need me?" before it answers "which kind of source?". Flattened, the page reads grey. */
  it("keeps the four origin inks four distinct values", () => {
    const record = objectConstant("HERKUNFT_INK");
    assert.ok(record !== null, `${VIEW}: HERKUNFT_INK is no longer a record the guard can read`);

    const inks = new Map<string, string>();
    for (const property of record.properties) {
      if (ts.isPropertyAssignment(property)) inks.set(property.name.getText(source), property.initializer.getText(source));
    }

    assert.deepEqual(
      [...inks.keys()].sort(),
      ["gruppe", "manuell", "offen", "spiel"],
      `${VIEW}: HERKUNFT_INK no longer names the four origins`,
    );
    assert.equal(
      new Set(inks.values()).size,
      4,
      `${VIEW}: the origins no longer read apart — ${[...inks].map(([origin, ink]) => `${origin}: ${ink}`).join(", ")}`,
    );
  });

  /* Decided 2026-08-27: the heading states the phase, and states it with an ordinal a phase chip
     drops, so a chip beside it repeats one fact and loses another. */
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

    /* Before the case under it, which reads two of these three: a row the guard cannot take apart
       would report the alignment of nothing. */
    it("is three cells the guard can tell apart", () => {
      assert.equal(cells.length, 3, `${VIEW}: expected three cells in a row, found ${String(cells.length)}`);
      assert.equal(pairCell.length, 1, `${VIEW}: expected one cell drawing SlotWiring, found ${String(pairCell.length)}`);
      assert.equal(actionCell.length, 1, `${VIEW}: expected one cell linking into the editor, found ${String(actionCell.length)}`);
      assert.equal(numberCell.length, 1, `${VIEW}: expected one remaining cell, found ${String(numberCell.length)}`);
      assert.ok(numberCell[0]?.body.includes("spiel.spiel_nr"), `${VIEW}: the remaining cell is not the fixture number's`);
    });

    /* Decided 2026-08-27: one cell declaring an alignment the other does not puts the control some
       sixty pixels above its own number on the worst phone row, and nothing else here catches it. */
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
