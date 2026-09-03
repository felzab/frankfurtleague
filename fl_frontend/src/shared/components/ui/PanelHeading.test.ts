import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement } from "react";

import { renderTree } from "@/shared/testing/renderTest";

/*
 Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
 static import beside it resolves first and dies on the extension (`docs/frontend/spec.md` §1.9).
*/
const { PanelHeading } = await import("./PanelHeading.tsx");

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

function tsxUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    return entry.isDirectory() ? tsxUnder(full) : entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const FILES = tsxUnder(SRC);
const COMPONENT = path.join(SRC, "shared", "components", "ui", "PanelHeading.tsx");
const rel = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

/** Comments blanked, so a heading NAMED in prose is not scanned as one rendered. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

type Heading = { level: string; tag: string; body: string };

/** Every heading, found by scanning rather than by a pattern that would have to close itself. */
function headings(source: string): Heading[] {
  const found: Heading[] = [];
  for (const level of ["1", "2", "3", "4", "5", "6"]) {
    const close = `</h${level}>`;
    let at = source.indexOf(`<h${level}`);
    while (at !== -1) {
      const opens = source.indexOf(">", at);
      const ends = source.indexOf(close, at);
      if (ends !== -1) found.push({ level, tag: source.slice(at, opens + 1), body: source.slice(opens + 1, ends) });
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
  it("leaves no hint inside a heading, by any route", () => {
    // A heading names itself from its contents and `Hint` renders a `role="button"` carrying a label of
    // its own, so a nested one is read out as part of the title.
    const nested = FILES.filter((file) => {
      const source = code(readFileSync(file, "utf8"));
      const names = hintBearingNames(source);

      return headings(source).some(({ body }) => body.includes("<Hint") || mentions(body, names));
    });

    assert.deepEqual(nested.map(rel), []);
  });

  it("leaves no panel heading spelled outside the shared one", () => {
    // What closes the route the case above cannot follow: a hint handed in as a PROP crosses a module
    // boundary no reader of one file can resolve. A panel that spells no heading can nest nothing in one.
    const spelled = FILES.filter(
      (file) => file !== COMPONENT && headings(code(readFileSync(file, "utf8"))).some(({ tag }) => tag.includes("heading()")),
    );

    assert.deepEqual(spelled.map(rel), []);
  });

  it("is the mechanism those headings use", () => {
    // Anti-vacuity: both cases above are equally true of a tree that stopped rendering panels at all.
    const users = FILES.filter((file) => readFileSync(file, "utf8").includes("<PanelHeading"));

    assert.ok(users.length >= 35, `expected the shared heading in at least 35 panels, found ${String(users.length)}`);
  });

  it("puts nothing but the title in the one heading it renders", () => {
    // The shared component is now the only place that could nest them again, and the only place the
    // panel's heading LEVEL is decided.
    assert.deepEqual(
      headings(HEADING).map(({ level, body }) => [level, body]),
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
    assert.ok(headings(HEADING)[0]?.tag.includes("inline"), "the heading takes the whole line, leaving the hint below it");
  });
});
