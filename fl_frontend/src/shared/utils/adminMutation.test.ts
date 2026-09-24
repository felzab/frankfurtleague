import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

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
