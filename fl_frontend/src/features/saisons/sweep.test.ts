import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every line as it was written, its fields whole: what a pass reports, and the code its failure carries. */
const lines: { level: "info" | "warn" | "error"; event: string; fields: unknown }[] = [];

const RUN = "/identity/erasure/sweep";

/** Each deletion call's answer, handed the place the call carried, null on a pass's first. */
let runAnswer: (after: string | null) => unknown = () => ran(0, 0);

/** One call of the pupils' deletion: whom it erased, who is still due after it, and where the pass goes on. */
const ran = (spieler: number, verbleibend: number, after: string | null = null) => ({
  completed_saison_id: "2526",
  spieler,
  saison_spieler: spieler,
  registrierungen: 0,
  skipped: 0,
  failed: 0,
  remaining: verbleibend,
  after,
});

/** The grants' claim with nothing to announce. */
const NOTHING_CLAIMED = { lease: null, leased_until: null, changes: [], recipient: [], skipped: 0 };

/** Every deletion call, with the place it carried. */
const runCalls: { params: Record<string, string> }[] = [];

// Replaced at the module boundary: the real client reaches a backend no test process runs.
doubleApiClient(async ({ endpoint }) => {
  // The grants' pass is armed by the same boot and answers to the suite of the comparison it asks for
  // (`fl_backend/tests/api/test_grants_execution.py`): here it claims nothing and is not recorded.
  if (endpoint.startsWith("/grants")) return NOTHING_CLAIMED;
  // The generated call carries its query in the endpoint.
  const sent = new URL(endpoint, "http://backend");
  expect(sent.pathname, `the pass reached a route nothing here answers: ${endpoint}`).toBe(RUN);
  const carried = Object.fromEntries(sent.searchParams);
  runCalls.push({ params: carried });
  return runAnswer(carried.after ?? null);
});

const LOGGING_DOUBLE = {
  logger: {
    debug: () => undefined,
    info: (event: string, fields?: unknown) => void lines.push({ level: "info", event, fields }),
    warn: (event: string, fields?: unknown) => void lines.push({ level: "warn", event, fields }),
    error: (event: string, _message: unknown, fields?: unknown) => void lines.push({ level: "error", event, fields }),
  },
};

vi.doMock("@/core/logging.ts", () => LOGGING_DOUBLE);

const { runErasureSweep } = await import("./sweep.ts");

/** Places in the `_id` order, as the mirror demands them. */
const ORT = `${"e".repeat(23)}5`;

/** Answers each call with the next of `answers`, the last one standing for every call after it. */
const inTurn = <T>(answers: T[]) => {
  let turn = 0;
  return (): T => answers[Math.min(turn++, answers.length - 1)] as T;
};

/** The pass's own lines, the grants' pass armed beside it writing lines of its own. */
const passLines = () => lines.filter(({ event }) => event.startsWith("erasure."));

beforeEach(() => {
  lines.length = 0;
  runCalls.length = 0;
  runAnswer = () => ran(0, 0);
});

describe("one pass of the pupils' deletion", () => {
  /* The pass is the caller's to hold: each call carries the place the call before it answered, and the first answer
     naming none ends it, whatever `verbleibend` still counts. */
  it("hands each call the place the last answer named, and calls no further once one names none", async () => {
    // The list closes on an answer naming no place, so a loop that ignores the end fails on its count rather than hanging.
    runAnswer = inTurn([ran(3, 2, ORT), ran(2, 1), ran(4, 4)]);

    await runErasureSweep();

    // A first call carrying no `after` at all, never a null one: present, the server reads it as an id.
    expect(runCalls.map(({ params }) => params)).toStrictEqual([{}, { after: ORT }]);
  });

  /** Answers a call carrying no place with the failing front, and the call carrying `ORT` with the due pupil behind it. */
  const frontThen = <T>(front: T, dahinter: T, end: T) => {
    let ohneOrt = 0;
    // Bounded: a loop dropping the place ends on its fourth call rather than hanging.
    return (after: string | null): T => (after === ORT ? dahinter : ++ohneOrt <= 3 ? front : end);
  };

  /* A share's worth of failing pupils fills the front, so the call reaching them deletes nobody while a due pupil stands
     behind them: a pass ending on that call, or reading the front again, never reaches that pupil. */
  it("goes on past a call that deleted nobody to the due pupils behind it, answering the pupils it failed as left", async () => {
    runAnswer = frontThen({ ...ran(0, 11, ORT), failed: 10 }, ran(1, 10), ran(0, 11));

    expect(await runErasureSweep()).toStrictEqual({
      count: {
        completed_saison_id: "2526",
        spieler: 1,
        saison_spieler: 1,
        registrierungen: 0,
        skipped: 0,
        failed: 10,
        remaining: 10,
      },
      open: 10,
    });
  });

  /* A pass cut short knows no remainder, so its failures alone are what it left, and the call's failure goes with the
     counts of what the calls before it erased. */
  it("answers a pass cut short with what it erased, the pupils it failed and the call's failure", async () => {
    runAnswer = (after) => {
      if (after === null) return { ...ran(3, 5, ORT), failed: 2 };
      throw new Error("the deletion was refused");
    };

    expect(await runErasureSweep()).toStrictEqual({
      count: { completed_saison_id: "2526", spieler: 3, saison_spieler: 3, registrierungen: 0, skipped: 0, failed: 2 },
      open: 2,
      error: new Error("the deletion was refused"),
    });
  });

  /* A place not past the one sent holds the pass, and every tick behind it, for ever. Each double ends on its third
     answer, so a loop lacking the guard fails on its calls rather than hanging. */
  for (const [how, spielort] of [
    ["the same place", ORT],
    ["a place before it", `${"e".repeat(23)}4`],
  ] as const) {
    it(`stops where a call answers ${how}, the deletions counted and the pass failing`, async () => {
      runAnswer = inTurn([ran(3, 5, ORT), ran(1, 4, spielort), ran(0, 0)]);

      const run = await runErasureSweep();

      expect(runCalls.map(({ params }) => params)).toStrictEqual([{}, { after: ORT }]);
      expect(run.count).toStrictEqual({
        completed_saison_id: "2526",
        spieler: 4,
        saison_spieler: 4,
        registrierungen: 0,
        skipped: 0,
        failed: 0,
      });
      expect(String("error" in run ? run.error : undefined)).toContain("The deletion answered a place not past the one it was sent.");
    });
  }

  /* What an operator reads on the scheduler's pass line to learn what the pass did: counts and the season the rule kept,
     never a person, an address or an id; and the pass writes no line of its own. */
  it("answers its counts and nothing else, writing no line", async () => {
    runAnswer = inTurn([ran(3, 1, ORT), ran(1, 0)]);

    expect(await runErasureSweep()).toStrictEqual({
      count: {
        completed_saison_id: "2526",
        spieler: 4,
        saison_spieler: 4,
        registrierungen: 0,
        skipped: 0,
        failed: 0,
        remaining: 0,
      },
      open: 0,
    });
    expect(passLines()).toStrictEqual([]);
  });
});
