import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import { renderMarkup } from "@/shared/testing/renderTest.ts";

describe("the render harness's next/error", () => {
  /* The harness hands the application's imports `catchError` alone; a package's own require of the
     module takes its default export too, which the harness's answer does not carry. */
  it("leaves a package's own require of next/error on the real module", () => {
    const insideNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));

    assert.equal(typeof (insideNext("next/error") as { default?: unknown }).default, "function");
  });
});

describe("the render harness's stack traces", () => {
  it("name the line of the component's own source that threw", async () => {
    const source = new URL("./ThrowingComponent.tsx", import.meta.url);
    const line =
      readFileSync(source, "utf8")
        .split("\n")
        .findIndex((text) => text.includes("throw new Error")) + 1;
    const { ThrowingComponent } = await import("./ThrowingComponent.tsx");

    assert.throws(
      () => renderMarkup(ThrowingComponent, { message: "a render that fails" }),
      (error: Error) => {
        assert.match(error.stack ?? "", new RegExp(`ThrowingComponent\\.tsx:${String(line)}:\\d+`));
        return true;
      },
    );
  });
});
