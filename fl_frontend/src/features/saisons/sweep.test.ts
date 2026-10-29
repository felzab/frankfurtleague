import { readFileSync } from "node:fs";
import path from "node:path";

import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { ACTOR_KEY_FILE } from "@/test-support/authDoubles.ts";
import { filesUnder, isTestFile } from "@/test-support/treeWalk.ts";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Every line as it was written, its fields whole: what a pass reports, and the code its failure carries. */
const lines: { level: "info" | "warn" | "error"; event: string; fields: unknown }[] = [];

/** The two switches as the doubled config answers them, which a case sets. */
let loeschungSwitch: string | undefined = "on";
let bewerbungSwitch: string | undefined = "off";

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

// Getters, not values: one process holds one module registry, so a case that could not re-read a switch could only
// ever prove one side of it.
const CONFIG_DOUBLE = {
  // Each boot runs in-process with no preflight naming a deployment.
  bootCheck: () => undefined,
  // Imported beside the settings by the boot gate, and called only on a deployment mismatch none of these boots has.
  refuseInvalidEnvironment: (): never => {
    throw new Error("the doubled config refuses no environment");
  },
  frontend_config: {
    // The boot reads the signing key before it arms anything.
    ACTOR_SIGNING_KEY_FILE: ACTOR_KEY_FILE,
    get BEWERBUNG_SWEEP() {
      return bewerbungSwitch;
    },
    get LOESCHUNG_SWEEP() {
      return loeschungSwitch;
    },
  },
};

/** Each loopback drop a pass asked for, with how many deletion calls had run by then. */
const drops: { tags: readonly string[]; laufCalls: number }[] = [];

vi.doMock("@/core/logging.ts", () => LOGGING_DOUBLE);
vi.doMock("@/core/config.ts", () => CONFIG_DOUBLE);
vi.doMock("@/core/authIndexes.ts", () => ({ buildAuthIndexes: () => Promise.resolve() }));
vi.doMock("@/core/revalidation.ts", () => ({
  revalidateOverLoopback: async (tags: readonly string[]) => void drops.push({ tags: tags, laufCalls: laufCalls.length }),
}));

const { register } = await import("../../instrumentation.ts");
const { runLoeschungSweep } = await import("./sweep.ts");

const SEKUNDE_MS = 1000;
const MINUTE_MS = 60 * SEKUNDE_MS;
const HOUR_MS = 60 * MINUTE_MS;

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
  drops.length = 0;
  loeschungSwitch = "on";
  bewerbungSwitch = "off";
  laufAnswer = () => gelaufen(0, 0);
});

describe("what register arms for the pupils' deletion", () => {
  // Next declares `NODE_ENV` read-only, which is true of the value a build inlines and not of this process's own
  // environment: the arm under test is exactly the one only a test can move.
  const env = process.env as Record<string, string | undefined>;

  /** One boot under `nodeEnv` with the switch reading `value`, then each step of `steps`, answering the calls made after each. */
  async function bootAndStep(nodeEnv: string, value: string | undefined, steps: readonly number[]): Promise<number[]> {
    const before = env.NODE_ENV;
    env.NODE_ENV = nodeEnv;
    loeschungSwitch = value;
    vi.useFakeTimers({ toFake: ["setInterval", "setTimeout"] });
    const counted: number[] = [];
    try {
      await register();
      for (const step of steps) {
        vi.advanceTimersByTime(step);
        await new Promise((resolve) => setImmediate(resolve));
        counted.push(laufCalls.length);
      }
    } finally {
      vi.useRealTimers();
      if (before === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = before;
    }

    return counted;
  }

  /* The press deletes under this switch and promises the next hourly pass deletes the rest: behind the application
     sweep's switch too, turning that one off would break the promise and leave the squad cache undropped. */
  it("waits its minute after a production boot reading on, then runs hourly, the application sweep's switch off", async () => {
    const steps = [MINUTE_MS - SEKUNDE_MS, SEKUNDE_MS, HOUR_MS - MINUTE_MS - SEKUNDE_MS, SEKUNDE_MS];

    expect(bewerbungSwitch, "the application sweep's switch is on, so the case proves nothing").toBe("off");
    expect(await bootAndStep("production", "on", steps)).toStrictEqual([0, 1, 1, 2]);
  });

  it("arms nothing where the switch is off", async () => {
    expect(await bootAndStep("production", "off", [3 * HOUR_MS])).toStrictEqual([0]);
  });

  // A skipped validation leaves the value undefined, which a test negating "off" would arm on.
  it("arms nothing where the value is missing", async () => {
    expect(await bootAndStep("production", undefined, [3 * HOUR_MS])).toStrictEqual([0]);
  });

  /* `next dev` reaches whatever backend the developer's own environment names, and deletes from it. */
  it("arms nothing under a development build, whatever the switch says", async () => {
    expect(await bootAndStep("development", "on", [3 * HOUR_MS])).toStrictEqual([0]);
  });
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

  /* A press's call its deadline cut deletes after the press dropped the tag, and no count shows those pupils, so the
     drop follows the pass's last call whatever the pass did. */
  const PASSES = [
    ["that deleted nobody", () => gelaufen(0, 0)],
    ["that deleted pupils", () => gelaufen(3, 0)],
    [
      "whose call threw",
      () => {
        throw new Error("the deletion was refused");
      },
    ],
  ] as const;

  for (const [what, answer] of PASSES) {
    it(`drops the squad cache once, after the last deletion call, on a pass ${what}`, async () => {
      laufAnswer = answer;

      await runLoeschungSweep();

      expect(drops).toStrictEqual([{ tags: ["spieler"], laufCalls: 1 }]);
    });
  }

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

  /* A pass slower than the hour would otherwise ask beside itself over the same share, which the backend's own judgement
     of each pupil makes safe and nothing makes useful. */
  it("skips a tick that finds the previous pass still running, with one line and no call", async () => {
    const held: (() => void)[] = [];
    // The call's answer is held until both ticks have run, as a slow backend holds it. Every one held is released, so a
    // second pass run beside the first fails the case rather than leaving it waiting.
    laufAnswer = () => new Promise((resolve) => void held.push(() => resolve(gelaufen(0, 0))));

    const running = runLoeschungSweep();
    const skipped = runLoeschungSweep();
    await skipped;
    for (const release of held) release();
    await running;

    expect(laufCalls.length, "the second tick called the backend beside the running pass").toBe(1);
    expect(passLines().map(({ level, event }) => `${level} ${event}`)).toStrictEqual([
      "info loeschung.sweep_skipped",
      "info loeschung.sweep_pass",
    ]);
  });
});

const LAUF_SENDER = "postLoeschungLauf";
const LAUF_SENDER_MODULE = "features/saisons/mutations.ts";

function declaresOrImports(node: ts.Identifier, where: string): boolean {
  if (ts.isFunctionDeclaration(node.parent) && node.parent.name === node) return where === LAUF_SENDER_MODULE;

  return ts.isImportSpecifier(node.parent) && node.parent.propertyName === undefined;
}

function enclosing(node: ts.Node): string {
  for (let at = node.parent; !ts.isSourceFile(at); at = at.parent) {
    if ((ts.isFunctionDeclaration(at) || ts.isMethodDeclaration(at)) && at.name !== undefined) return at.name.getText();
    if ((ts.isArrowFunction(at) || ts.isFunctionExpression(at)) && ts.isVariableDeclaration(at.parent)) return at.parent.name.getText();
  }

  return "(module)";
}

describe("the deletion pass's callers", () => {
  /* The API deletes on any system-key call, the switch read by the press and by the boot arming the timer, so a third
     caller would delete while it reads off. Each caller's off arm is driven in its own suite. */
  it("are the hourly pass and the activation alone, and its path has one sender", () => {
    const src = path.resolve(import.meta.dirname, "..", "..");
    const uses: string[] = [];
    const senders: string[] = [];

    for (const file of filesUnder(src, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 200)) {
      const text = readFileSync(file, "utf8");
      if (!text.includes(LAUF_SENDER) && !text.includes(LAUF)) continue;
      const where = path.relative(src, file).split(path.sep).join("/");

      const visit = (node: ts.Node): void => {
        // Every reference, not only a call: the hourly pass hands the function on by name, and an alias or a
        // wrapper beside the declaration is a third caller.
        if (ts.isIdentifier(node) && node.text === LAUF_SENDER && !declaresOrImports(node, where)) uses.push(`${where} :: ${enclosing(node)}`);
        if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && node.text.includes(LAUF))
          senders.push(`${where} :: ${enclosing(node)}`);
        ts.forEachChild(node, visit);
      };
      visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true));
    }

    expect(uses.sort()).toStrictEqual(["features/saisons/actions.ts :: activateSaisonAction", "features/saisons/sweep.ts :: sweepLoeschung"]);
    expect(senders).toStrictEqual([`${LAUF_SENDER_MODULE} :: ${LAUF_SENDER}`]);
  });
});
