import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

describe("the render harness's next/error", () => {
  /* The harness hands the application's imports `catchError` alone; a package's own require of the
     module takes its default export too, which the harness's answer does not carry. */
  it("leaves a package's own require of next/error on the real module", () => {
    const insideNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));

    assert.equal(typeof (insideNext("next/error") as { default?: unknown }).default, "function");
  });
});
