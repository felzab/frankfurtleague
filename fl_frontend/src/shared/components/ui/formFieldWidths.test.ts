import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..", "..");

function parse(relative: string): ts.SourceFile {
  const full = path.join(SRC_DIR, ...relative.split("/"));

  return ts.createSourceFile(relative, readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** The static halves of a class list, an interpolated constant contributing a break rather than its tokens. */
function classText(node: ts.Node | undefined): string {
  if (node === undefined) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isJsxExpression(node)) return classText(node.expression);
  if (ts.isTemplateExpression(node)) return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(" ");

  return "";
}

type Element = { tag: string; classes: string[] };

function asWritten(node: ts.JsxElement | ts.JsxSelfClosingElement, source: ts.SourceFile): Element {
  const opening = ts.isJsxElement(node) ? node.openingElement : node;
  const className = opening.attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className",
  );

  return {
    tag: opening.tagName.getText(source),
    classes: classText(className !== undefined && ts.isJsxAttribute(className) ? className.initializer : undefined)
      .split(/\s+/)
      .filter(Boolean),
  };
}

const isElement = (node: ts.Node): node is ts.JsxElement | ts.JsxSelfClosingElement =>
  ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);

/** Every element a file writes, in source order, each with the classes it is written with. */
function elementsIn(source: ts.SourceFile): Element[] {
  const found: Element[] = [];

  const visit = (node: ts.Node): void => {
    if (isElement(node)) found.push(asWritten(node, source));
    ts.forEachChild(node, visit);
  };

  visit(source);
  return found;
}

/**
 * The address editor's rows that seat two fields beside each other, never the column stacking those
 * rows: the pair is the shape a specified width overflows, and the column has no pair in it.
 */
function pairRowsIn(source: ts.SourceFile): Element[][] {
  const rows: Element[][] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const row = asWritten(node, source);

      if (row.tag === "div" && row.classes.includes("flex") && !row.classes.includes("flex-col")) {
        rows.push(
          node.children
            .filter(isElement)
            .map((child) => asWritten(child, source))
            .filter((child) => child.tag === "TextField"),
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return rows;
}

const PAIR_ROWS = pairRowsIn(parse("shared/components/ui/AddressFields.tsx"));

const WEBSITE_ELEMENTS = elementsIn(parse("features/teams/components/forms/WebsiteUrlField.tsx"));

/** A width the element fixes for itself. `min-w-0` is the one exception, that class REMOVING a floor. */
const SPECIFIED_WIDTH = /^(?:w|min-w|basis)-(?!0$)/;

describe("the two fields an address row seats side by side", () => {
  it("finds both rows, and two fields in each", () => {
    // A floor before the cases below, which a sweep that matched nothing would leave vacuously true.
    assert.equal(PAIR_ROWS.length, 2, "the sweep no longer finds the address editor's two paired rows");

    for (const row of PAIR_ROWS) {
      assert.equal(row.length, 2, "a paired row no longer seats two fields");
    }
  });

  /* The split is over the FREE space, which the gap comes out of first: two widths summing to the
     container put the whole gap past it, and no shrinking reclaims any of it while a flex item's
     automatic minimum is its own input's intrinsic width. */
  it("floors neither field at its own width, and leaves the gap its room", () => {
    for (const field of PAIR_ROWS.flat()) {
      const list = field.classes.join(" ");

      assert.ok(field.classes.includes("min-w-0"), `${list}: the field cannot shrink under the intrinsic width of its input`);
      assert.ok(
        field.classes.some((name) => /^flex-\d+$/.test(name)),
        `${list}: the field takes its share of something other than the free space`,
      );
      assert.ok(
        !field.classes.some((name) => SPECIFIED_WIDTH.test(name)),
        `${list}: a width the field fixes for itself leaves the gap standing outside the row`,
      );
    }
  });
});

const websiteMatching = (tag: string): Element[] => WEBSITE_ELEMENTS.filter((element) => element.tag === tag);

describe("the box inside the website field's group", () => {
  it("finds the group and the input standing in it", () => {
    assert.equal(websiteMatching("InputGroup").length, 1, "the sweep no longer finds the website field's group");
    assert.equal(websiteMatching("InputGroup.Input").length, 1, "the sweep no longer finds the box inside that group");
  });

  /* HeroUI gives the group's input `flex: 1` and no floor of its own, so its automatic minimum is the
     browser's default input width, wider than the room the prefix leaves it. Both levels: a floor on
     the group stops the shrinking above the input. */
  it("lets the shrinking reach the input rather than flooring it at its intrinsic width", () => {
    for (const element of [...websiteMatching("InputGroup"), ...websiteMatching("InputGroup.Input")]) {
      assert.ok(element.classes.includes("min-w-0"), `${element.tag}: an automatic minimum floors it, and the row cannot shrink past it`);
    }
  });
});
