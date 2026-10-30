import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import type { ApiCall } from "@/test-support/apiClientDouble.ts";

const LISTE = "/spielbestaetigungen/sweep";

/** The listing's answer, and each season's pass's, which a case sets; an `Error` is thrown, as a failed call throws. */
let listeAnswer: () => unknown;
let passAnswer: (saisonId: string) => unknown;

const pass = (saisonId: string, counts: Partial<Record<"closed" | "asked" | "reminded" | "mails" | "failed", number>> = {}) => ({
  saison_id: saisonId,
  closed: 0,
  asked: 0,
  reminded: 0,
  mails: 0,
  failed: 0,
  ...counts,
});

const calls = doubleApiClient(async (call: ApiCall) => {
  const answer = call.endpoint === LISTE ? listeAnswer() : passAnswer(/^\/spielbestaetigungen\/sweep\/(\d+)$/.exec(call.endpoint)?.[1] ?? "");
  if (answer instanceof Error) throw answer;
  assert.ok(call.endpoint.startsWith(LISTE), `the pass reached a route nothing here answers: ${call.endpoint}`);
  return answer;
});

const { runSpielSweep } = await import("./sweep.ts");

beforeEach(() => {
  calls.length = 0;
  listeAnswer = () => ({ saison_ids: ["2627", "2728"] });
  passAnswer = (saisonId) => pass(saisonId);
});

describe("the fixture confirmation job", () => {
  /* The counts, summed over the seasons, are the one record of what the job did, on the scheduler's pass line; the rows
     it passed over owe no deletion, so it leaves nothing the heartbeat names. */
  it("sweeps every listed season and answers what the passes did", async () => {
    passAnswer = (saisonId) => pass(saisonId, saisonId === "2627" ? { closed: 2, asked: 3, mails: 7 } : { reminded: 1, mails: 2, failed: 1 });

    expect(await runSpielSweep()).toStrictEqual({
      count: { closed: 2, asked: 3, reminded: 1, mails: 9, failed: 1 },
      open: 0,
    });
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([LISTE, `${LISTE}/2627`, `${LISTE}/2728`]);
  });

  /* The scheduler reports a pass ending on a failure to the heartbeat, which a job answering with a line alone keeps from it. */
  it("rejects where a season's pass fails, sweeping no season after it", async () => {
    passAnswer = (saisonId) => (saisonId === "2627" ? new Error("the backend went away") : pass(saisonId));

    await expect(runSpielSweep()).rejects.toThrow("the backend went away");
    expect(calls.map(({ endpoint }) => endpoint)).toStrictEqual([LISTE, `${LISTE}/2627`]);
  });
});
