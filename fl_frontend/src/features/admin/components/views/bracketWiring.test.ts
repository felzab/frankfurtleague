import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { PILL_TINT_CLASSES } from "@/shared/components/ui/badges.ts";
import { elementsIn, parseModule, staticValue } from "@/shared/testing/jsxReader.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";

import type { JsxRead } from "@/shared/testing/jsxReader.ts";

const VIEW = "AdminBracketWiringView.tsx";

/* Reached with `await import` and never a static import beside the harness above, which registers the
   JSX compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminBracketWiringView } = await import("./AdminBracketWiringView.tsx");

/** A `Map` and not the record itself, so a tone name the view invented reads back as absent rather than as `any`. */
const TONE_PAIRS = new Map<string, string>(Object.entries(PILL_TINT_CLASSES));

/**
 * The view as written and not as rendered: a recipe call and its expansion render alike. Parsed
 * rather than matched as text, so an assertion here survives the view being reformatted; what the
 * parse cannot reach is left unpinned.
 */
const text = readFileSync(path.resolve(import.meta.dirname, VIEW), "utf8");
const source = parseModule(VIEW, text);
const elements = elementsIn(source);

/** A span of the file an element can sit inside. */
type Range = { start: number; end: number };

/** The className attribute's own source, which is where a recipe call shows and `classes` cannot. */
const classSourceOf = (element: JsxRead): string => element.attributes.get("className")?.getText(source) ?? "";

/** A bare `aria-hidden` is `true`, and `aria-hidden="false"` leaves the element in the tree, so neither is read as its presence. */
function isHiddenFrom(element: JsxRead): boolean {
  if (!element.attributes.has("aria-hidden")) return false;

  const value = element.attributes.get("aria-hidden");
  if (value === undefined) return true;
  if (ts.isStringLiteral(value)) return value.text !== "false";
  if (ts.isJsxExpression(value) && value.expression !== undefined) return value.expression.kind !== ts.SyntaxKind.FalseKeyword;

  return true;
}

/* Read with a walk of their own: the shared reader answers about elements, and these two cases are about
   a call and a constructed index, neither of which is one. */
const calls: string[] = [];
const constructed: string[] = [];
const visit = (node: ts.Node): void => {
  if (ts.isCallExpression(node)) calls.push(node.expression.getText(source));
  if (ts.isNewExpression(node) && node.expression.getText(source) === "Map") constructed.push(node.getText(source));
  ts.forEachChild(node, visit);
};
visit(source);

const tags = new Set(elements.map((element) => element.tag));
const taggedAs = (tag: string): JsxRead[] => elements.filter((element) => element.tag === tag);
/** Whitespace-free, so a prettier reflow of a child expression does not move the element it belongs to. */
const carries = (element: JsxRead, child: string): boolean => element.own.replace(/\s+/g, "") === child;

function namedImportsFrom(module: string): Set<string> {
  const names = new Set<string>();

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== module && !statement.moduleSpecifier.text.startsWith(`${module}/`)) continue;

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
const inside = (element: JsxRead, ranges: readonly (Range | null)[]): boolean =>
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
    const recipes = elements.filter((element) => /\bcard\(/.test(classSourceOf(element)) && inside(element, wiring));

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
    const items = elements.filter((element) => staticValue(element.attributes.get("role")) === "listitem");

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
      // A borrow from `PHASE_TINTS` is a tone by construction, that map's own annotation naming it.
      if (tint.startsWith("PHASE_TINTS.")) continue;

      const pair = TONE_PAIRS.get(tint.slice(1, -1)) ?? "";
      assert.notEqual(pair, "", `${VIEW}: the ${origin} origin is ${tint}, which names no member of \`PILL_TINT_CLASSES\``);

      const tokens = pair.split(/\s+/);
      assert.ok(
        tokens.some((token) => token.includes("bg-")) && tokens.some((token) => token.includes("text-")),
        `${VIEW}: the ${origin} origin is ${tint}, which paints no chip`,
      );
    }
  });

  /* A Chip's `color` resolves against HeroUI's own tokens, which this app maps none of, and a Tag
     renders unstyled — `tag.css` is imported nowhere. Both compile, lint and build. */
  it("paints the origin with the app's label pill and a class string", () => {
    assert.ok(namedImportsFrom("@/shared/components/ui/badges").has("labelBadge"), `${VIEW}: the origin no longer wears the app's label pill`);
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
    const pairCell = cells.filter((cell) => cell.text.includes("SlotWiring"));
    const actionCell = cells.filter((cell) => cell.text.includes("adminSpielEditHref"));
    const numberCell = cells.filter((cell) => !cell.text.includes("SlotWiring") && !cell.text.includes("adminSpielEditHref"));

    /* Before the cases under it, which read all three: a row the guard cannot take apart would report
       the alignment of nothing. */
    it("is three cells the guard can tell apart", () => {
      assert.equal(cells.length, 3, `${VIEW}: expected three cells in a row, found ${String(cells.length)}`);
      assert.equal(pairCell.length, 1, `${VIEW}: expected one cell drawing SlotWiring, found ${String(pairCell.length)}`);
      assert.equal(actionCell.length, 1, `${VIEW}: expected one cell linking into the editor, found ${String(actionCell.length)}`);
      assert.equal(numberCell.length, 1, `${VIEW}: expected one remaining cell, found ${String(numberCell.length)}`);
      assert.ok(numberCell[0]?.text.includes("spiel.spiel_nr"), `${VIEW}: the remaining cell is not the fixture number's`);
    });

    /* The shape the doubled number had: a marker drawn for the eye and hidden from the reading, one
       space from an origin that opens on an ordinal of its own. A childless one is decoration. */
    it("draws no reading in the pair cell that is hidden from assistive technology", () => {
      assert.ok(pairCell[0] !== undefined, `${VIEW}: no pair cell to read`);

      const slot = rangeOfFunction("SlotWiring");
      assert.ok(slot !== null, `${VIEW}: SlotWiring is no longer a declaration the guard can place`);

      const silenced = elements.filter(
        (element) => isHiddenFrom(element) && element.own.trim() !== "" && inside(element, [pairCell[0] ?? null, slot]),
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

describe("the bracket wiring's empty state", () => {
  const empty = (isFinishedSaison: boolean): string =>
    textOf(renderMarkup(AdminBracketWiringView, { rounds: [], saisonId: "2026", isFinishedSaison }), " ");

  /* A finished season's bracket is not still to come, so a „noch“ or a hint waiting on the Spieltage tells a
     reader of a past season to come back for rounds that were never drawn. */
  it("says a finished season has no Finalrunden, and promises none", () => {
    assert.ok(empty(true).includes("Für diese Saison gibt es keine Finalrunden."), empty(true));
    assert.doesNotMatch(empty(true), /\bnoch\b|sobald/i);
  });

  it("keeps the running season's promise that the KO-Runde's Spieltage are still to come", () => {
    assert.ok(empty(false).includes("Für diese Saison gibt es noch keine Finalrunden."), empty(false));
    assert.ok(empty(false).includes("Sobald die Spieltage der KO-Runde angelegt sind"), empty(false));
  });
});
