import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

/* Replaced at the module boundary, as `fl_frontend/src/shared/utils/publicRoute.test.ts` replaces them:
   the trace seed and the framework's control-flow rethrow are the framework's, and the spine between
   them and the action is what is driven. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "next/headers": `export const headers = async () => new Headers();`,
  "next/navigation": `export const unstable_rethrow = () => {};`,
};
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { runAdminMutation } = await import("./adminMutation.ts");
const { boundCall, REQUEST_DEADLINE_MS } = await import("@/core/requestScope");

/** What an action answers when its own code throws, declared a read or a write at its call site. */
const thrownIn = (readOnly: boolean) =>
  runAdminMutation("probeAction", { readOnly: readOnly }, async (): Promise<{ success: true }> => {
    throw new RangeError("Invalid time value");
  });

describe("a throw of an admin action's own code", () => {
  /* A write's code after its API call can throw with the row already stored: answered as a failure,
     the admin repeats a write that may stand. */
  it("answers a write as of unknown outcome", async () => {
    const answer = await thrownIn(false);

    assert.equal(answer.success, false);
    assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown");
  });

  it("answers a read, which changed nothing, as the failure it is", async () => {
    const answer = await thrownIn(true);

    assert.equal("outcome" in answer ? answer.outcome : undefined, undefined);
    assert.equal("error" in answer ? answer.error : undefined, "Lade die Seite neu und versuche es erneut.");
  });
});

describe("an admin action the request's deadline cut", () => {
  /** `performance.now()`'s reading, which the deadline is measured on. */
  let clock = 0;

  beforeEach(() => {
    clock = 0;
    mock.method(performance, "now", () => clock);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  /** An action that asks for one bounded call once the deadline has passed, and then answers `settled` as a fan-out settles a refused send. */
  const cutIn = (readOnly: boolean, settled: { success: boolean; message?: string }) =>
    runAdminMutation("probeAction", { readOnly: readOnly }, () => {
      clock += REQUEST_DEADLINE_MS;
      boundCall(1000);

      return Promise.resolve(settled);
    });

  /* The shape the mail actions take: every send settled, the refused one among them, and a clean
     sentence built from what settled while a message may already be in somebody's inbox. */
  it("answers a write as of unknown outcome, whatever the action answered itself", async () => {
    for (const settled of [
      { success: true, message: "Gesendet." },
      { success: false, message: "Die E-Mail konnte nicht gesendet werden." },
    ]) {
      const answer = await cutIn(false, settled);

      assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown", `a cut write answered ${JSON.stringify(answer)}`);
    }
  });

  it("answers a read with what it answered itself, a read changing nothing", async () => {
    const settled = { success: false, message: "Der Server hat zu lange nicht geantwortet." };

    assert.deepEqual(await cutIn(true, settled), settled);
  });

  it("answers a write the deadline never cut with what it answered itself", async () => {
    const settled = { success: true, message: "Gespeichert." };
    const answer = await runAdminMutation("probeAction", { readOnly: false }, () => {
      boundCall(1000).clear();

      return Promise.resolve(settled);
    });

    assert.deepEqual(answer, settled);
  });
});
