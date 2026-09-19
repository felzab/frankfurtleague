import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { elementsIn, parseModule, staticValue } from "./jsxReader.ts";

/** One shape per case the tree writes, so a reader stopping at the first is separable from a correct one. */
const SAMPLE = `
const a = <div className="flex gap-2"><span className={CHIP}>x</span></div>;
const b = <Table.Cell className={\`px-6 \${INSET} w-40\`} role="cell" aria-hidden />;
const c = <Button className={tv({ base: "size-9" })} />;
const d = <br />;
`;

const read = elementsIn(parseModule("sample.tsx", SAMPLE));
const taggedAs = (tag: string): (typeof read)[number] => read.find((element) => element.tag === tag) ?? assert.fail(`no <${tag}>`);

describe("the reader every JSX sweep goes through", () => {
  it("finds every element, nested and self-closing alike, in source order", () => {
    assert.deepEqual(
      read.map((element) => element.tag),
      ["div", "span", "Table.Cell", "Button", "br"],
    );
  });

  /* A template's own text is declared and its hole is not: a reader taking the head alone drops
     `w-40`, and one reading the hole as tokens invents classes nothing writes. */
  it("reads a template's written tokens and leaves its hole to the interpolated names", () => {
    const cell = taggedAs("Table.Cell");

    assert.deepEqual(cell.classes, ["px-6", "w-40"]);
    assert.deepEqual(cell.interpolated, ["INSET"]);
    assert.equal(cell.isClassInterpolated, true);
  });

  it("names a bare interpolated constant and reports no token for it", () => {
    const span = taggedAs("span");

    assert.deepEqual(span.classes, []);
    assert.deepEqual(span.interpolated, ["CHIP"]);
    assert.equal(span.isClassInterpolated, true);
  });

  /* A recipe call binds no name the caller can resolve, so it has to read as interpolated with no
     name: taken as bare, every element wearing one would be reported as spelling nothing. */
  it("marks a class list a call builds as interpolated, naming nothing", () => {
    const button = taggedAs("Button");

    assert.deepEqual(button.classes, []);
    assert.deepEqual(button.interpolated, []);
    assert.equal(button.isClassInterpolated, true);
  });

  it("reads a plain list as written and an element with no class attribute as bare", () => {
    assert.deepEqual(taggedAs("div").classes, ["flex", "gap-2"]);
    assert.equal(taggedAs("div").isClassInterpolated, false);
    assert.deepEqual(taggedAs("br").classes, []);
    assert.equal(taggedAs("br").isClassInterpolated, false);
  });

  it("carries every attribute the opening tag declares, a bare one included", () => {
    const cell = taggedAs("Table.Cell");

    assert.deepEqual([...cell.attributes.keys()], ["className", "role", "aria-hidden"]);
    assert.equal(staticValue(cell.attributes.get("role")), "cell");
    assert.equal(cell.attributes.get("aria-hidden"), undefined, "a bare attribute reads as carrying a value");
  });

  it("places each element in the file and hands back its own source", () => {
    const div = taggedAs("div");

    assert.equal(div.line, 2);
    assert.ok(div.text.startsWith("<div"), "an element's source is not its own");
    assert.equal(div.own, "<span className={CHIP}>x</span>");
    assert.equal(taggedAs("br").own, "", "a self-closing element reports children");
    assert.ok(taggedAs("span").start > div.start && taggedAs("span").end < div.end, "a nested element sits outside its parent's span");
  });
});
