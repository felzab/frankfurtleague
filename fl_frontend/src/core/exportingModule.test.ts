import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exportingModule, overridingModule, UNBINDABLE } from "./exportingModule.ts";

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
