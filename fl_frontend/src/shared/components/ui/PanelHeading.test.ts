import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement } from "react";

import { openingTag } from "@/core/openingTag.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { renderTree } from "@/shared/testing/renderTest";

/*
 Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
 static import beside it resolves first and dies on the extension.
*/
const { PanelHeading } = await import("./PanelHeading.tsx");

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

const FILES = filesUnder(SRC, (name) => name.endsWith(".tsx") && !isTestFile(name), 200);
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

/** Comments blanked, so a heading NAMED in prose is not scanned as one rendered. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

type Heading = { level: string; tag: string; body: string };

/**
 * Every heading, found by scanning rather than by a pattern that would have to close itself.
 *
 * `subject` is positional and undefaulted so no caller can throw without naming what it was reading.
 */
function headings(source: string, subject: string): Heading[] {
  const found: Heading[] = [];
  for (const level of ["1", "2", "3", "4", "5", "6"]) {
    const close = `</h${level}>`;
    let at = source.indexOf(`<h${level}`);
    while (at !== -1) {
      const tag = openingTag(source, at);
      const ends = source.indexOf(close, at);
      // Thrown rather than skipped: a heading dropped here is a heading the cases below never judge,
      // and each of them reads an empty list as a clean tree.
      if (tag === "") throw new Error(`${subject}: an <h${level}> opening tag could not be read`);
      if (ends === -1) throw new Error(`${subject}: an <h${level}> never closes`);
      found.push({ level, tag, body: source.slice(at + tag.length, ends) });
      at = source.indexOf(`<h${level}`, at + 1);
    }
  }

  return found;
}

/** The shared heading as a panel renders it, with a hint of the panel's own handed in beside. */
const HEADING = renderTree(
  createElement(
    PanelHeading,
    { className: "fluid-md font-bold", title: "Kontaktpersonen" },
    createElement("span", { id: "hinweis" }, "Wer erreichbar ist"),
  ),
);

/**
 * Names in this module whose own declaration renders a hint.
 *
 * A sweep that finds its subjects by their spelling misses `{SEAT_HINT[rolle]}`, which holds one.
 */
function hintBearingNames(source: string): Set<string> {
  const names = new Set<string>();
  const declarations = [...source.matchAll(/^(?:export )?(?:const|let|function) (\w+)/gm)];
  for (const [index, declaration] of declarations.entries()) {
    const ends = declarations[index + 1]?.index ?? source.length;
    if (source.slice(declaration.index, ends).includes("<Hint")) names.add(declaration[1]!);
  }

  return names;
}

/** Split on the non-identifier runs, so a name is matched whole rather than inside a longer one. */
const mentions = (body: string, names: Set<string>) => body.split(/[^A-Za-z0-9_$]+/).some((token) => names.has(token));

describe("a panel's hint sits beside its heading", () => {
  // A hint inside a heading is read out as part of the title. `hint-nest` in
  // `fl_frontend/eslint.config.mjs :: SOURCE_BANS` refuses a `<Hint…>` or `<InfoHint>` tag written there; no selector
  // follows a name to the declaration rendering one.
  it("leaves no hint inside a heading through a name that renders one", () => {
    const nested = FILES.filter((file) => {
      const source = code(readFileSync(file, "utf8"));
      const names = hintBearingNames(source);

      return headings(source, rel(file)).some(({ body }) => mentions(body, names));
    });

    assert.deepEqual(nested.map(rel), []);
  });

  it("reads the headings the tree renders", () => {
    // Anti-vacuity: the case above is equally true of a reader that stopped finding headings at all.
    const read = FILES.flatMap((file) => headings(code(readFileSync(file, "utf8")), rel(file)));

    assert.ok(read.length >= 60, `expected at least 60 headings across the tree, the sweep read ${String(read.length)}`);
  });

  it("puts nothing but the title in the one heading it renders", () => {
    // The shared component is now the only place that could nest them again, and the only place the
    // panel's heading LEVEL is decided.
    assert.deepEqual(
      headings(HEADING, "PanelHeading").map(({ level, body }) => [level, body]),
      [["2", "Kontaktpersonen"]],
      "the shared heading no longer renders exactly one `<h2>` holding its title alone",
    );
  });

  it("renders the hint as the heading's next sibling, sharing the title's line box", () => {
    // Dropping `{children}` takes every hint off the page, which the cases above read as a success: no
    // heading holds a hint once no heading has one to hold.
    assert.ok(HEADING.includes('</h2><span id="hinweis"'), "the shared heading renders nothing beside its title");
    // `docs/frontend/spec.md :: I81`: a text run's mass sits above its box's centre, so a flex row
    // centring the pair looks wrong where the shared line box does not.
    assert.match(HEADING, /^<div><h2 /, "the pair is laid out by a box of its own rather than by the title's own line");
    assert.ok(headings(HEADING, "PanelHeading")[0]?.tag.includes("inline"), "the heading takes the whole line, leaving the hint below it");
  });

  /* A heading this walk discards sits in no list, and the sweep above reads an empty list as a clean
     tree — so the one shape that could hide a nested hint is the one it never sees. */
  it("fails on a heading it cannot read rather than dropping it", () => {
    assert.throws(() => headings("<h2 title={x}<div>Kontaktpersonen</h2>", "unlesbar"), /could not be read/);
    assert.throws(() => headings('<h2 className="fluid-md">Kontaktpersonen', "offen"), /never closes/);
  });
});
