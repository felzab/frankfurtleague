import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const SRC = path.resolve(import.meta.dirname, "..");

/** Long enough for a child that ends promptly, short enough that one held open by a skipped cleanup fails rather than stalls. */
const CHILD_TIMEOUT_MS = 60_000;

/** Runs `source` as a test file in a child of its own, as `actionDoubles.test.ts`'s child runs a fixture. */
function runAsFile(source: string): { status: number | null; output: string; timedOut: boolean } {
  const scratch = mkdtempSync(path.join(tmpdir(), "fl-verdicts-"));
  const fixture = path.join(scratch, "judged.test.mjs");
  writeFileSync(fixture, source);
  // Without `NODE_TEST_CONTEXT`, under which a child refuses to run a file, and without the gate's shard.
  const env = { ...process.env, NODE_OPTIONS: (process.env.NODE_OPTIONS ?? "").replace(/--test-shard=\S+/g, "") };
  Reflect.deleteProperty(env, "NODE_TEST_CONTEXT");
  try {
    const run = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(path.join(SRC, "..", "scripts", "tsconfig-alias-hook.mjs")).href, "--test", "--test-reporter=spec", fixture],
      { encoding: "utf8", timeout: CHILD_TIMEOUT_MS, env },
    );
    return { status: run.status, output: `${run.stdout}${run.stderr}`, timedOut: run.error !== undefined };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

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
    const run = runAsFile(AFTER_SHAPE);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("LATER AFTER RAN"), run.output);
    assert.ok(run.output.includes("the file's last case: planted file verdict"), run.output);
  });

  // Ahead of the later hook, so a file a leaked handle holds open past its hooks still names its verdict.
  it("prints its verdict as it records it", () => {
    const run = runAsFile(AFTER_SHAPE);
    const printed = run.output.indexOf("a judging hook recorded a failure, thrown once every cleanup has run:\n- the file's last case");

    assert.ok(printed !== -1, run.output);
    assert.ok(printed < run.output.indexOf("LATER AFTER RAN"), run.output);
  });

  // A double's own judgement, so a call site that throws again is caught where a helper alone would pass.
  it("leaves a later `afterEach` to run after the fetch double's verdict on an unanswered request", () => {
    const run = runAsFile(`import { afterEach, beforeEach, it } from "node:test";
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
    const run = runAsFile(`import { after, it } from "node:test";
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
    const run = runAsFile(AFTER_EACH_SHAPE);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("LATER AFTEREACH RAN"), run.output);
    assert.ok(run.output.includes("leaves a verdict: planted case verdict"), run.output);
  });
});
