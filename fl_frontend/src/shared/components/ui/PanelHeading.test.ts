import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

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

/** Every heading element's contents, found by scanning rather than by a pattern that has to close itself. */
function headingBodies(source: string): string[] {
  const bodies: string[] = [];
  for (const level of ["1", "2", "3", "4", "5", "6"]) {
    const open = `<h${level}`;
    const close = `</h${level}>`;
    let at = source.indexOf(open);
    while (at !== -1) {
      const ends = source.indexOf(close, at);
      if (ends !== -1) bodies.push(source.slice(source.indexOf(">", at) + 1, ends));
      at = source.indexOf(open, at + 1);
    }
  }

  return bodies;
}

describe("a panel's hint sits beside its heading", () => {
  it("leaves no hint inside a heading", () => {
    // A heading names itself from its contents and `Hint` renders a `role="button"` carrying a label of
    // its own, so a nested one is read out as part of the title.
    const nested = FILES.filter((file) => headingBodies(code(readFileSync(file, "utf8"))).some((body) => body.includes("<Hint")));

    assert.deepEqual(nested.map(rel), []);
  });

  it("is the mechanism those headings use", () => {
    // Anti-vacuity: the case above is equally true of a tree that stopped rendering hints at all.
    const users = FILES.filter((file) => readFileSync(file, "utf8").includes("<PanelHeading"));

    assert.ok(users.length >= 30, `expected the shared heading in at least 30 panels, found ${String(users.length)}`);
  });

  it("puts nothing but the title in the heading it renders", () => {
    // What the sweep cannot see: the shared component is the one place that could nest them again.
    const bodies = headingBodies(code(readFileSync(COMPONENT, "utf8")));

    assert.deepEqual(
      bodies.map((body) => body.trim()),
      ["{title}"],
    );
  });

  it("renders the hint as the heading's next sibling", () => {
    // Dropping `{children}` takes every hint off the page, which the sweep above reads as a success:
    // no heading holds a hint once no heading has one to hold.
    const source = code(readFileSync(COMPONENT, "utf8"));
    const beside = source.slice(source.indexOf("</h2>"));

    assert.ok(beside.includes("{children}"), "the shared heading renders nothing beside its title");
  });
});
