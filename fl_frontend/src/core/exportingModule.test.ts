import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exportingModule, UNBINDABLE } from "./exportingModule.ts";

const LINE_SEPARATOR = String.fromCharCode(0x2028);

describe("the module a double is built as", () => {
  /* No real module can hand the hooks such a name, their pattern reading identifier characters alone,
     so the builder is asked directly: its source spells every export name as code. */
  it("refuses to declare a name that is no identifier", () => {
    for (const name of ['x", (globalThis.escaped = true), "', `x${LINE_SEPARATOR}y`]) {
      assert.throws(() => exportingModule({ [name]: 1 }), /is no name a module can declare/, JSON.stringify(name));
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
});
