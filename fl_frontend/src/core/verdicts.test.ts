import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAsTestFile } from "./childTestRun.ts";

const AFTER_SHAPE = `import { after, it } from "node:test";
import { judging } from "@/core/verdicts.ts";
after(() => judging("the file's last case", () => { throw new Error("planted file verdict"); }));
const held = setInterval(() => undefined, 1000);
after(() => { clearInterval(held); process.stderr.write("LATER AFTER RAN"); });
it("passes", () => {});
`;

const AFTER_EACH_SHAPE = `import { afterEach, beforeEach, it } from "node:test";
import { judging } from "@/core/verdicts.ts";
afterEach((t) => judging(t.fullName, () => { throw new Error("planted case verdict"); }));
let held;
beforeEach(() => { held = setInterval(() => undefined, 1000); });
afterEach(() => { clearInterval(held); process.stderr.write("LATER AFTEREACH RAN"); });
it("leaves a verdict", () => {});
`;

/* Each child holds a resource a later hook releases, so a verdict thrown from its hook would leave it
   running until the timeout (`docs/frontend/spec.md` §1.9). */
describe("a hook that judges", () => {
  it("leaves every later `after` to run, and fails the file once they have", () => {
    const run = runAsTestFile(AFTER_SHAPE);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("LATER AFTER RAN"), run.output);
    assert.ok(run.output.includes("the file's last case: planted file verdict"), run.output);
  });

  // Ahead of the later hook, so a file a leaked handle holds open past its hooks still names its verdict.
  it("prints its verdict as it records it", () => {
    const run = runAsTestFile(AFTER_SHAPE);
    const printed = run.output.indexOf("a judging hook recorded a failure, thrown once every cleanup has run:\n- the file's last case");

    assert.ok(printed !== -1, run.output);
    assert.ok(printed < run.output.indexOf("LATER AFTER RAN"), run.output);
  });

  // A double's own judgement, so a call site that throws again is caught where a helper alone would pass.
  it("leaves a later `afterEach` to run after the fetch double's verdict on an unanswered request", () => {
    const run = runAsTestFile(`import { afterEach, beforeEach, it } from "node:test";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
doubleFetch();
let held;
beforeEach(() => { held = setInterval(() => undefined, 1000); });
afterEach(() => { clearInterval(held); process.stderr.write("LATER AFTEREACH RAN"); });
it("sends a request it never answers", () => { void fetch("http://backend.invalid/probe"); });
`);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("LATER AFTEREACH RAN"), run.output);
    assert.ok(run.output.includes("the case sent a request it never answered"), run.output);
  });

  it("leaves every later `after` to run after a db suite's teardown whose close failed", () => {
    const run = runAsTestFile(`import { after, it } from "node:test";
import { closeJudgingExpiredTransactions } from "@/core/expiredTransactions.ts";
after(() => closeJudgingExpiredTransactions(undefined, () => Promise.reject(new Error("planted close failure"))));
const held = setInterval(() => undefined, 1000);
after(() => { clearInterval(held); process.stderr.write("LATER AFTER RAN"); });
it("passes", () => {});
`);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("LATER AFTER RAN"), run.output);
    assert.ok(run.output.includes("this file's teardown: planted close failure"), run.output);
  });

  it("leaves every later `afterEach` to run, and names the case it judged", () => {
    const run = runAsTestFile(AFTER_EACH_SHAPE);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("LATER AFTEREACH RAN"), run.output);
    assert.ok(run.output.includes("leaves a verdict: planted case verdict"), run.output);
  });
});
