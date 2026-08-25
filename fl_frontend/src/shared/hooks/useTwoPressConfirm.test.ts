import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Source text rather than a render: the repository has no DOM runner, and every claim below is about
 * the ORDER of statements inside `press`, which no exported value carries.
 */
const SOURCE = readFileSync(path.resolve(import.meta.dirname, "useTwoPressConfirm.ts"), "utf8");

/** The press handler alone, up to the return that follows it. */
const PRESS = (SOURCE.split("const press = (write: () => Promise<void>) => {")[1] ?? "").split("return {")[0] ?? "";

describe("the two-press confirm", () => {
  /* First, because a boundary string that stopped matching leaves the slice empty and every
     assertion over it would then fail for something that is not the defect. */
  it("cuts the press handler out of the file before reading it", () => {
    assert.ok(PRESS.includes("startWriting("), "the write is outside the handler's slice");
    assert.ok(!PRESS.includes("export function"), "the handler's slice runs on past the hook");
  });

  /* Two presses, and the second one writes. Without the arming branch ahead of the write the alert
     never renders and one press is the whole confirmation, on writes nothing reverses. */
  it("arms on the first press and writes on the second", () => {
    const arming = PRESS.indexOf("if (!isConfirming)");
    const writing = PRESS.indexOf("startWriting(");

    assert.ok(arming !== -1, "no arming branch in press");
    assert.ok(writing !== -1, "press starts no transition");
    assert.ok(arming < writing, "the first press writes, so the alert never renders");
  });

  /* Ahead of the arming branch is the whole of it: a guard behind it runs on the first press only,
     and an editor's fields stay live until the second one. */
  it("runs the guard before arming and again before writing", () => {
    const guard = PRESS.indexOf("!guard()");
    const arming = PRESS.indexOf("if (!isConfirming)");

    assert.ok(guard !== -1, "press consults no guard");
    assert.ok(guard < arming, "a draft typed after arming is discarded by the write");
  });

  /* A refused guard has to leave the control unarmed as well as unpressed, or the alert stays open
     saying a write is one press away that the next press will refuse again. */
  it("disarms the control when the guard refuses", () => {
    const refusal = (PRESS.split("!guard())")[1] ?? "").split("if (!isConfirming)")[0] ?? "";

    assert.match(refusal, /setIsConfirming\(false\)/);
  });

  /* Clear it before the await and the alert, the destructive fill and the closed cancel all drop the
     moment the request starts, leaving a pending write with the resting control's appearance. */
  it("holds the armed state until the write has answered", () => {
    const body = PRESS.split("startWriting(async () => {")[1] ?? "";

    assert.ok(body.indexOf("await write()") < body.indexOf("setIsConfirming(false)"), "the armed state drops while the write is in flight");
  });
});
