import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every line as it was written, its fields whole: what a pass reports, and the code its failure carries. */
const lines: { level: "info" | "warn" | "error"; event: string; fields: unknown }[] = [];

const LAUF = "/identitaet/loeschung/lauf";

/** Each deletion call's answer, handed the place the call carried, null on a pass's first. */
let laufAnswer: (nach: string | null) => unknown = () => gelaufen(0, 0);

/** One call of the pupils' deletion: whom it erased, who is still due after it, and where the pass goes on. */
const gelaufen = (spieler: number, verbleibend: number, nach: string | null = null) => ({
  acknowledged: 1,
  abgeschlossene_saison_id: "2526",
  spieler: spieler,
  saison_spieler: spieler,
  registrierungen: 0,
  uebersprungen: 0,
  fehlgeschlagen: 0,
  verbleibend: verbleibend,
  nach: nach,
});

/** The grants' claim with nothing to announce. */
const NOTHING_CLAIMED = { acknowledged: 1, beanspruchung: null, beansprucht_bis: null, aenderungen: [], empfaenger: [], uebersprungen: 0 };

/** Every deletion call, with the place it carried. */
const laufCalls: { params: Record<string, string> }[] = [];

// Replaced at the module boundary: the real client reaches a backend no test process runs.
doubleApiClient(async ({ endpoint, params }, schema) => {
  // The grants' pass is armed by the same boot and answers to its own suite
  // (`fl_frontend/src/features/berechtigungen/abgleich.test.ts`): here it claims nothing and is not recorded.
  if (endpoint.startsWith("/berechtigungen")) return schema.parse(NOTHING_CLAIMED);
  expect(endpoint, `the pass reached a route nothing here answers: ${endpoint}`).toBe(LAUF);
  const carried = (params ?? {}) as Record<string, string>;
  laufCalls.push({ params: carried });
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift.
  return schema.parse(await laufAnswer(carried.nach ?? null));
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

const { runLoeschungSweep } = await import("./sweep.ts");

/** Places in the `_id` order, as the mirror demands them. */
const ORT = `${"e".repeat(23)}5`;

/** Answers each call with the next of `answers`, the last one standing for every call after it. */
const inTurn = <T>(answers: T[]) => {
  let turn = 0;
  return (): T => answers[Math.min(turn++, answers.length - 1)] as T;
};

/** The pass's own lines, the grants' pass armed beside it writing lines of its own. */
const passLines = () => lines.filter(({ event }) => event.startsWith("loeschung."));

beforeEach(() => {
  lines.length = 0;
  laufCalls.length = 0;
  laufAnswer = () => gelaufen(0, 0);
});

describe("one pass of the pupils' deletion", () => {
  /* The pass is the caller's to hold: each call carries the place the call before it answered, and the first answer
     naming none ends it, whatever `verbleibend` still counts. */
  it("hands each call the place the last answer named, and calls no further once one names none", async () => {
    // The list closes on an answer naming no place, so a loop that ignores the end fails on its count rather than hanging.
    laufAnswer = inTurn([gelaufen(3, 2, ORT), gelaufen(2, 1), gelaufen(4, 4)]);

    await runLoeschungSweep();

    // A first call carrying no `nach` at all, never a null one: present, the server reads it as an id.
    expect(laufCalls.map(({ params }) => params)).toStrictEqual([{}, { nach: ORT }]);
  });

  /** Answers a call carrying no place with the failing front, and the call carrying `ORT` with the due pupil behind it. */
  const vorneDann = <T>(vorne: T, dahinter: T, ende: T) => {
    let ohneOrt = 0;
    // Bounded: a loop dropping the place ends on its fourth call rather than hanging.
    return (nach: string | null): T => (nach === ORT ? dahinter : ++ohneOrt <= 3 ? vorne : ende);
  };

  /* A share's worth of failing pupils fills the front, so the call reaching them deletes nobody while a due pupil stands
     behind them: a pass ending on that call, or reading the front again, never reaches that pupil. */
  it("goes on past a call that deleted nobody to the due pupils behind it, warning the pupils it failed", async () => {
    laufAnswer = vorneDann({ ...gelaufen(0, 11, ORT), fehlgeschlagen: 10 }, gelaufen(1, 10), gelaufen(0, 11));

    await runLoeschungSweep();

    // A warning, the pass leaving pupils it failed: a level above INFO would drop the line counting them.
    expect(passLines()).toStrictEqual([
      {
        level: "warn",
        event: "loeschung.sweep_pass",
        fields: {
          abgeschlossene_saison_id: "2526",
          spieler: 1,
          saison_spieler: 1,
          registrierungen: 0,
          uebersprungen: 0,
          fehlgeschlagen: 10,
          verbleibend: 10,
        },
      },
    ]);
  });

  /* A pass cut short knows no remainder, so its failures alone make the line a warning beside its own error. */
  it("warns where the pass is cut short after a call that failed pupils", async () => {
    laufAnswer = (nach) => {
      if (nach === null) return { ...gelaufen(3, 5, ORT), fehlgeschlagen: 2 };
      throw new Error("the deletion was refused");
    };

    await runLoeschungSweep();

    expect(passLines()).toStrictEqual([
      {
        level: "warn",
        event: "loeschung.sweep_pass",
        fields: {
          abgeschlossene_saison_id: "2526",
          spieler: 3,
          saison_spieler: 3,
          registrierungen: 0,
          uebersprungen: 0,
          fehlgeschlagen: 2,
        },
      },
      { level: "error", event: "loeschung.sweep_failed", fields: { name: "Error" } },
    ]);
  });

  /* A place not past the one sent holds the pass, and every tick behind it, for ever. Each double ends on its third
     answer, so a loop lacking the guard fails on its calls and lines rather than hanging. */
  for (const [wie, ort] of [
    ["the same place", ORT],
    ["a place before it", `${"e".repeat(23)}4`],
  ] as const) {
    it(`stops where a call answers ${wie}, the deletions counted and its own line filed`, async () => {
      laufAnswer = inTurn([gelaufen(3, 5, ORT), gelaufen(1, 4, ort), gelaufen(0, 0)]);

      await runLoeschungSweep();

      expect(laufCalls.map(({ params }) => params)).toStrictEqual([{}, { nach: ORT }]);
      expect(passLines()).toStrictEqual([
        {
          level: "info",
          event: "loeschung.sweep_pass",
          fields: { abgeschlossene_saison_id: "2526", spieler: 4, saison_spieler: 4, registrierungen: 0, uebersprungen: 0, fehlgeschlagen: 0 },
        },
        { level: "error", event: "loeschung.sweep_failed", fields: { name: "ContractBreakError" } },
      ]);
    });
  }

  /* What an operator reads to learn the pass ran and what it did: counts and the season the rule kept, never a person,
     an address or an id. */
  it("writes one line per pass, holding its counts and nothing else", async () => {
    laufAnswer = inTurn([gelaufen(3, 1, ORT), gelaufen(1, 0)]);

    await runLoeschungSweep();

    expect(passLines()).toStrictEqual([
      {
        level: "info",
        event: "loeschung.sweep_pass",
        fields: {
          abgeschlossene_saison_id: "2526",
          spieler: 4,
          saison_spieler: 4,
          registrierungen: 0,
          uebersprungen: 0,
          fehlgeschlagen: 0,
          verbleibend: 0,
        },
      },
    ]);
  });
});
