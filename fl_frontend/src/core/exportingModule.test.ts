import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { exportedNames, exportingModule, overridingModule, replacingModule, replacingPackage, UNBINDABLE } from "./exportingModule.ts";

const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("the module a double is built as", () => {
  /* No real module can hand the hooks such a name, their pattern reading identifier characters alone,
     so each builder is asked directly: its source spells every export name as code. */
  it("refuses to declare a name that is no identifier", () => {
    for (const name of ['x", (globalThis.escaped = true), "', `x${LINE_SEPARATOR}y`]) {
      assert.throws(() => exportingModule({ [name]: 1 }), /is no name a module can declare/, JSON.stringify(name));
      assert.throws(
        () => overridingModule("data:text/javascript,", { [name]: () => 1 }),
        /is no name a module can declare/,
        JSON.stringify(name),
      );
    }
  });

  it("refuses to declare a word a module cannot bind", () => {
    for (const name of UNBINDABLE) {
      assert.throws(() => exportingModule({ [name]: 1 }), /is no name a module can declare/, name);
    }
  });

  /* The list is this file's, and the engine is the authority on it: a word the engine would bind is
     one the builder refuses for nothing. */
  it("refuses only words the engine itself refuses to bind in a module", async () => {
    for (const name of UNBINDABLE) {
      await assert.rejects(import(`data:text/javascript,${encodeURIComponent(`export const { ${name} } = {};`)}`), SyntaxError, name);
    }
  });

  /* A German export name is one the engine binds, so a double refusing it fails the suite of the module declaring it. */
  it("declares a name holding a letter outside ASCII", async () => {
    const built = (await import(`data:text/javascript,${encodeURIComponent(exportingModule({ prüfeÄnderung: 1 }))}`)) as Record<
      string,
      unknown
    >;

    assert.equal(built.prüfeÄnderung, 1);
  });

  it("hands each value across unchanged, whatever characters it carries", async () => {
    const message = `"'\\${LINE_SEPARATOR}</script>`;
    const built = (await import(`data:text/javascript,${encodeURIComponent(exportingModule({ message }))}`)) as Record<string, unknown>;

    assert.equal(built.message, message);
  });

  /* The value itself, never a copy: a double records into the object its suite reads, and a builder
     serialising values would pass the case above while every recording went to a copy. */
  it("hands each object and function across as itself", async () => {
    const recorded: unknown[] = [];
    const record = (entry: unknown): number => recorded.push(entry);
    const built = (await import(`data:text/javascript,${encodeURIComponent(exportingModule({ recorded, record }))}`)) as Record<
      string,
      unknown
    >;

    assert.equal(built.recorded, recorded);
    assert.equal(built.record, record);
  });
});

/** `source` as a module on disk, named `fileName` in a directory of its own, for the reader to open. */
function moduleOnDisk(fileName: string, source: string): { url: string; file: string; remove: () => void } {
  const scratch = mkdtempSync(path.join(tmpdir(), "fl-exports-"));
  const file = path.join(scratch, fileName);
  writeFileSync(file, source);

  return { url: pathToFileURL(file).href, file, remove: () => rmSync(scratch, { recursive: true, force: true }) };
}

/* One statement per shape a module exports through, each beside a neighbour that must not count, so a
   reader dropping a shape or taking its neighbour fails on that shape's name. */
const EVERY_SHAPE = `
/* export const imCommentStehend = 1; */
// export const inEinerZeile = 1;
export async function speichere(): Promise<void> {}
export function überladen(wert: string): string;
export function überladen(wert: number): number;
export function überladen(wert: unknown): unknown { return wert; }
export const { eins, zwei: [drei, , vier], ...rest } = { eins: 1, zwei: [3, 0, 4] };
export let zähler = 0;
export class Tabelle {}
const intern = 1, auchIntern = 2;
export { intern, auchIntern as umbenannt, type Nur };
export type Nur = string;
export interface Form {}
export declare const erklärt: number;
export const save$Entwurf = 1;
export default function () {}
`;

describe("the names a real module exports", () => {
  it("reads every run-time export, and neither a type nor a name inside a comment", () => {
    const { file, remove } = moduleOnDisk("everyShape.ts", EVERY_SHAPE);

    try {
      assert.deepEqual(
        exportedNames(file).sort(),
        [
          "Tabelle",
          "umbenannt",
          "default",
          "drei",
          "eins",
          "intern",
          "rest",
          "save$Entwurf",
          "speichere",
          "vier",
          "zähler",
          "überladen",
        ].sort(),
      );
    } finally {
      remove();
    }
  });

  /* Either would leave the double short of names it cannot see, which fails to link as a hand-kept list does. */
  it("refuses a whole-module re-export and a namespace rather than reading past them", () => {
    for (const [fileName, source] of [
      ["reexport.ts", 'export * from "./anderes.ts";\n'],
      ["namespace.ts", "export namespace Raum { export const wert = 1; }\n"],
    ] as const) {
      const { file, remove } = moduleOnDisk(fileName, source);

      try {
        assert.throws(() => exportedNames(file), /whose names this reader does not follow/, fileName);
      } finally {
        remove();
      }
    }
  });
});

describe("the module a double replaces a real one with", () => {
  /* The real module throws as it evaluates, as one opening a database driver would where no database is. */
  const REAL =
    'export const doubled = () => "real";\nexport const leftAlone = () => "real";\nthrow new Error("the real module was evaluated");\n';

  it("exports every name the real module does, without evaluating it", async () => {
    const { url, remove } = moduleOnDisk("replaced.mjs", REAL);

    try {
      const built = (await import(
        `data:text/javascript,${encodeURIComponent(replacingModule(url, "the probe", { doubled: () => "double" }))}`
      )) as {
        doubled: () => string;
        leftAlone: () => string;
      };

      assert.equal(built.doubled(), "double");
      assert.throws(() => built.leftAlone(), /the probe's leftAlone is not doubled/);
    } finally {
      remove();
    }
  });
});

describe("the module a double replaces an installed package with", () => {
  it("exports every name the package does, read past a double already standing over it", async () => {
    // A suite's own hook, registered after this file's imports: its answer would hand over its own names.
    registerHooks({
      resolve: (specifier, context, nextResolve) =>
        specifier === "next/headers"
          ? { url: "data:text/javascript,export const headers = 1;", shortCircuit: true }
          : nextResolve(specifier, context),
    });
    const built = (await import(
      `data:text/javascript,${encodeURIComponent(replacingPackage("next/headers", { headers: () => "double" }))}`
    )) as Record<string, () => unknown>;

    assert.deepEqual(Object.keys(built).sort(), ["cookies", "draftMode", "headers"]);
    assert.equal(built.headers!(), "double");
    assert.throws(() => built.cookies!(), /next\/headers's cookies is not doubled/);
  });
});

describe("the module a double stands over a real one as", () => {
  /* A `data:` URL keeps its quote as written: spelled into the source, it would end the specifier. */
  const REAL = `data:text/javascript,export const kept = "it's the real one"; export const answer = () => 1;`;

  it("keeps every export the real module has, and builds each override from the real module itself", async () => {
    const built = (await import(
      `data:text/javascript,${encodeURIComponent(overridingModule(REAL, { answer: (real) => () => (real.answer as () => number)() + 41 }))}`
    )) as { kept: string; answer: () => number };

    assert.equal(built.kept, "it's the real one");
    assert.equal(built.answer(), 42);
  });
});
