import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { INTERNAL_API_KEY } = await import("./config.ts");

const LENGTH = 64;
const pad = (head: string): string => head + "k".repeat(LENGTH - [...head].length);

describe("the schema the three internal API keys share", () => {
  it("takes a key of printable ASCII, the placeholder the runbook prints among them", () => {
    for (const key of [pad("a"), "x".repeat(LENGTH), pad("!~-_.+/=")]) {
      assert.equal(INTERNAL_API_KEY.safeParse(key).success, true, `refused ${String([...key].length)} printable characters`);
    }
  });

  it("refuses a key of the right length carrying one non-ASCII character", () => {
    // `secrets.compare_digest` on the backend raises rather than answering false for this key, so
    // the API would answer every internal request 500 instead of 401.
    assert.equal(INTERNAL_API_KEY.safeParse(pad("ü")).success, false);
  });

  it("refuses a key of 64 code points carrying one astral character", () => {
    // The case the length check alone already refuses HERE and accepts on the backend: this
    // `length` counts the surrogate pair twice and Python's counts it once.
    const astral = pad("\u{1F600}");

    assert.equal([...astral].length, LENGTH);
    assert.equal(astral.length, LENGTH + 1);
    assert.equal(INTERNAL_API_KEY.safeParse(astral).success, false);
  });

  it("refuses a key a space would let through a bearer header", () => {
    assert.equal(INTERNAL_API_KEY.safeParse(pad("a b")).success, false);
  });

  it("refuses any other length", () => {
    for (const length of [LENGTH - 1, LENGTH + 1]) {
      assert.equal(INTERNAL_API_KEY.safeParse("k".repeat(length)).success, false, `accepted ${String(length)} characters`);
    }
  });
});
