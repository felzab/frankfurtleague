import { beforeEach, describe, expect, it } from "vitest";

import { APINetworkError } from "@/core/errors";
import { networkFailure, serveBackend } from "@/test-support/backend";
import { captureLog } from "@/test-support/stdoutCapture";

/** The running seasons alone: a confirmation serves no purpose once its season is over. */
const LIST = "/saisons/sweep";

/** The listing's answer, and each season's pass's, which a case sets. */
let listAnswer: () => unknown;
let passAnswer: (saisonId: string) => unknown;

const pass = (counts: Partial<Record<"closed" | "asked" | "reminded" | "mails" | "failed", number>> = {}) => ({
  closed: 0,
  asked: 0,
  reminded: 0,
  mails: 0,
  failed: 0,
  ...counts,
});

/** A season's pass, as the contract spells its path. */
const SEASON_PASS = /^\/spielbestaetigungen\/saisons\/(\d+)\/sweep$/;

// The listing read and each season's pass, and nothing else: any other request fails the case.
const backend = serveBackend(({ method, path, search }) => {
  if (method === "GET" && path === LIST && search.get("status") === "active") return listAnswer();
  const saisonId = method === "POST" ? SEASON_PASS.exec(path)?.[1] : undefined;
  return saisonId === undefined ? undefined : passAnswer(saisonId);
});
/** Every line the real logger writes, read off standard output. */
const log = captureLog();

const { runSpielSweep } = await import("./sweep");

/** Every request in the order sent. */
const sent = (): string[] => backend.sent.map(({ method, path }) => `${method} ${path}`);

beforeEach(() => {
  listAnswer = () => ({ saison_ids: ["2627", "2728"] });
  passAnswer = () => pass();
});

describe("the fixture confirmation job", () => {
  /* The counts, summed over the seasons, are the one record of what the job did, on the scheduler's pass line; the rows
     it passed over owe no deletion, so it leaves nothing the heartbeat names. */
  it("sweeps every listed season and answers what the passes did", async () => {
    passAnswer = (saisonId) => pass(saisonId === "2627" ? { closed: 2, asked: 3, mails: 7 } : { reminded: 1, mails: 2, failed: 1 });

    expect(await runSpielSweep()).toStrictEqual({
      count: { closed: 2, asked: 3, reminded: 1, mails: 9, failed: 1 },
      open: 0,
      error: undefined,
    });
    expect(sent()).toStrictEqual([
      `GET ${LIST}`,
      "POST /spielbestaetigungen/saisons/2627/sweep",
      "POST /spielbestaetigungen/saisons/2728/sweep",
    ]);
  });

  /* One season's outage skips no later season's confirmations, and the scheduler reports the failure to the heartbeat,
     which a job answering with a line alone keeps from it. */
  it("sweeps every season past one whose pass fails, and answers the failure", async () => {
    passAnswer = (saisonId) => (saisonId === "2627" ? networkFailure() : pass());

    const { error } = await runSpielSweep();

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toStrictEqual([expect.any(APINetworkError)]);
    expect(sent()).toStrictEqual([
      `GET ${LIST}`,
      "POST /spielbestaetigungen/saisons/2627/sweep",
      "POST /spielbestaetigungen/saisons/2728/sweep",
    ]);
    expect(log.lines().map(({ message, fields: { saison_id } }) => ({ message, saison_id }))).toStrictEqual([
      { message: "spielbestaetigung.sweep_failed", saison_id: "2627" },
    ]);
  });
});
