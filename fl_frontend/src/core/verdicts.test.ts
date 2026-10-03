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

/** A file whose double judges each case ahead of the file's own `afterEach`, which releases what the case held. */
const judgedPerCase = (setup: string, leave: string): string => `import { afterEach, beforeEach, it } from "node:test";
${setup}
let held;
beforeEach(() => { held = setInterval(() => undefined, 1000); });
afterEach(() => { clearInterval(held); process.stderr.write("LATER AFTEREACH RAN"); });
it("leaves a verdict", async () => { ${leave} });
`;

/** Each shared double's own per-case verdict, so a double whose hook throws again fails where `judging` alone would pass. */
const DOUBLES = [
  {
    double: "the fetch double",
    setup: `import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
doubleFetch();`,
    leave: `void fetch("http://backend.invalid/probe");`,
    verdict: "the case sent a request it never answered",
  },
  {
    double: "the actions double",
    setup: `import { doubleActions } from "@/shared/testing/actionDoubles.ts";
const { answerWith } = doubleActions({ modules: ["/src/features/spieltage/actions.ts"] });
const spieltage = await import("@/features/spieltage/actions.ts");`,
    leave: `answerWith(() => new Promise(() => undefined)); void spieltage.patchSpieltagAction({ id: "s1" });`,
    verdict: "the case left these actions pending",
  },
  {
    double: "the API client double",
    setup: `import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
doubleApiAnswers();
const { apiClient } = await import("@/core/api.ts");`,
    leave: `await apiClient("/probe", { parse: () => { throw new Error("malformed"); } }).catch(() => undefined);`,
    verdict: "the case answered these calls with a body the real client refuses as malformed",
  },
  {
    double: "the route request double",
    setup: `import { doubleRouteRequest } from "@/shared/testing/undoRoutes.ts";
doubleRouteRequest();
const { updateTag } = await import("next/cache");`,
    leave: `try { updateTag("probe"); } catch {}`,
    verdict: "the route called what Next refuses outside a Server Action",
  },
] as const;

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

  for (const { double, setup, leave, verdict } of DOUBLES) {
    it(`leaves a later \`afterEach\` to run after ${double}'s verdict, naming the case`, () => {
      const run = runAsTestFile(judgedPerCase(setup, leave));

      assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
      assert.equal(run.status, 1, run.output);
      assert.ok(run.output.includes("LATER AFTEREACH RAN"), run.output);
      assert.ok(run.output.includes(`leaves a verdict: ${verdict}`), run.output);
    });
  }

  // A suite's own `after` runs before the file's, so its request reaches the double's file-end verdict.
  it("leaves a later `after` to run after the fetch double's verdict on a request sent past the last case", () => {
    const run = runAsTestFile(`import { after, describe, it } from "node:test";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
doubleFetch();
const held = setInterval(() => undefined, 1000);
describe("a suite", () => {
  after(() => { void fetch("http://backend.invalid/late"); });
  it("passes", () => {});
});
after(() => { clearInterval(held); process.stderr.write("LATER AFTER RAN"); });
`);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("LATER AFTER RAN"), run.output);
    assert.ok(run.output.includes("the file's last case: a request was sent after the file's last case had ended"), run.output);
  });

  // A timer the file's last hook queued fires once every hook has run, where only the process's end judges.
  it("fails the file for a request the fetch double meets after every hook", () => {
    const run = runAsTestFile(`import { after, it } from "node:test";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
doubleFetch();
after(() => { setTimeout(() => void fetch("http://backend.invalid/late"), 0); });
it("passes", () => {});
`);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("the file's end: a request was sent after the file's hooks had run"), run.output);
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

  it("refuses a db suite's replica set that started but was never watched", () => {
    const run = runAsTestFile(`import { after, it } from "node:test";
import { closeJudgingExpiredTransactions } from "@/core/expiredTransactions.ts";
after(() => closeJudgingExpiredTransactions({}, () => Promise.resolve()));
it("passes", () => {});
`);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("this file's teardown: this file's replica set was started but its count was never read"), run.output);
    // The one cause left: a read that fails ends its file before the helper registers any teardown.
    assert.ok(run.output.includes("not judged: the container was started past `startJudgedReplicaSet`."), run.output);
  });

  it("leaves every later `afterEach` to run, and names the case it judged", () => {
    const run = runAsTestFile(AFTER_EACH_SHAPE);

    assert.equal(run.timedOut, false, `the child was held open past its timeout:\n${run.output}`);
    assert.equal(run.status, 1, run.output);
    assert.ok(run.output.includes("LATER AFTEREACH RAN"), run.output);
    assert.ok(run.output.includes("leaves a verdict: planted case verdict"), run.output);
  });
});
