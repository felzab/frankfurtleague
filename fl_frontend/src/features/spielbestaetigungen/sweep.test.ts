import { networkFailure, serveBackend } from "@/test-support/backend.ts";
import { beforeEach, describe, expect, it } from "vitest";

import { APINetworkError } from "@/core/errors.ts";

const LIST = "/spielbestaetigungen/sweep";

/** The listing's answer, and each season's pass's, which a case sets. */
let listAnswer: () => unknown;
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

/** A season's pass, as the contract spells its path. */
const SEASON_PASS = /^\/spielbestaetigungen\/sweep\/(\d+)$/;

// The listing read and each season's pass, and nothing else: any other request fails the case.
const backend = serveBackend(({ method, path }) => {
  if (method === "GET" && path === LIST) return listAnswer();
  const saisonId = method === "POST" ? SEASON_PASS.exec(path)?.[1] : undefined;
  return saisonId === undefined ? undefined : passAnswer(saisonId);
});

const { runSpielSweep } = await import("./sweep.ts");

/** Every request in the order sent. */
const sent = (): string[] => backend.sent.map(({ method, path }) => `${method} ${path}`);

beforeEach(() => {
  listAnswer = () => ({ saison_ids: ["2627", "2728"] });
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
    expect(sent()).toStrictEqual([`GET ${LIST}`, `POST ${LIST}/2627`, `POST ${LIST}/2728`]);
  });

  /* The scheduler reports a pass ending on a failure to the heartbeat, which a job answering with a line alone keeps from it. */
  it("rejects where a season's pass fails, sweeping no season after it", async () => {
    passAnswer = (saisonId) => (saisonId === "2627" ? networkFailure() : pass(saisonId));

    await expect(runSpielSweep()).rejects.toThrow(APINetworkError);
    expect(sent()).toStrictEqual([`GET ${LIST}`, `POST ${LIST}/2627`]);
  });
});
