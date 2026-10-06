import assert from "node:assert/strict";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { serverActionModules } from "@/core/treeWalk.ts";
import { cacheCalls, doubleActionRequest, loggedLines } from "@/shared/testing/actionDoubles.ts";
import { PERSON_ACTION_MODULES, srcPathOf } from "@/shared/testing/actionLanes.ts";

/* The subject lookup, the sign-in store, the logger and the framework's request packages, doubled
   before the `await import`s below; the spine between them and the action is what is driven. */
const { setSubject } = doubleActionRequest({ session: null });

const { runPersonMutation, runPersonRecordMutation } = await import("./personMutation.ts");
const { runPersonRead } = await import("./personRead.ts");
const { KONTO_FORBIDDEN } = await import("./kontoMutation.ts");
const { SITZ_WEG } = await import("./actionError.ts");
const { getRequestActor, markOutcomeUnknown, recordWriteSent } = await import("@/core/requestScope.ts");
const { PersonReadWithoutSubjectError } = await import("@/core/errors.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");

const ACTION_MODULES = serverActionModules(20);
/** The person lane's modules, read off Next's own population by the lane table both spines share. */
const PERSON_ACTION_FILES = ACTION_MODULES.filter((file) => PERSON_ACTION_MODULES.has(srcPathOf(file)));

/** Team A this season, the address the fixture's seat stands at. */
const HELD = { team_id: SITZ.team_id, saison_id: SITZ.saison_id };
const OTHER_TEAM = "6890a1b2c3d4e5f607250012";

/** How many times the spine asked Next to refresh the page since the case began. */
const refreshes = (): number => cacheCalls.filter(({ name }) => name === "refresh").length;

/** A body that counts its runs and answers a success, so a case reads whether the guard let it run. */
function countingBody() {
  const ran = { count: 0 };
  const body = () => {
    ran.count += 1;
    return Promise.resolve({ success: true as const, message: "Gespeichert." });
  };

  return { ran, body };
}

/**
 * The person actions claiming a record rather than a seat, by `<slice> :: <export>`; every other export
 * claims a seat. Declared, never read off behaviour: an export behind the wrong entry then fails its
 * kind instead of joining the other.
 */
const CLAIMS_A_RECORD: ReadonlySet<string> = new Set<string>([
  "kontakte :: patchBewerbungEinwilligungAction",
  "kontakte :: patchSitzEinwilligungAction",
  "registrierungen :: patchRegistrierungEinwilligungAction",
  "schiedsrichter :: patchSchiedsrichterEinwilligungAction",
  "spieler :: patchSpielerEinwilligungAction",
]);

type PersonAction = (argument: unknown) => Promise<unknown>;

/** Every export of every slice's person actions, by `<slice> :: <export>`. */
async function everyPersonAction(): Promise<Map<string, PersonAction>> {
  const found = new Map<string, PersonAction>();
  for (const file of PERSON_ACTION_FILES) {
    const slice = path.basename(path.dirname(file));
    const actions = Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>);
    assert.ok(actions.length > 0, `${slice}'s person actions module exports nothing, so nothing here holds it`);

    for (const [name, action] of actions) {
      assert.equal(typeof action, "function", `${slice} :: ${name} is exported from a "use server" module and is no action`);
      found.set(`${slice} :: ${name}`, action as PersonAction);
    }
  }

  return found;
}

/** What each action answered `argument` with, against a network that refuses every call and counts it. */
async function answersOf(actions: Map<string, PersonAction>, argument: unknown): Promise<{ answers: Map<string, unknown>; sent: number }> {
  const answers = new Map<string, unknown>();
  const fetched = mock.method(globalThis, "fetch", () => Promise.reject(new Error("a person's action reached the network unguarded")));
  try {
    for (const [name, action] of actions) answers.set(name, await action(argument));
  } finally {
    fetched.mock.restore();
  }

  return { answers, sent: fetched.mock.callCount() };
}

/**
 * Which entry an action ran behind, for a person seated on one team claiming another's: the seat entry
 * refuses and logs why, the record entry admits the session and leaves the record to the backend.
 */
async function entryOf(action: PersonAction): Promise<"seat" | "record"> {
  setSubject(person({ sitze: [sitz()] }));
  loggedLines.length = 0;
  const fetched = mock.method(globalThis, "fetch", () => Promise.reject(new Error("no network in this sweep")));
  try {
    await action({ team_id: OTHER_TEAM, saison_id: SITZ.saison_id });
  } finally {
    fetched.mock.restore();
  }

  const refused = loggedLines.some((line) => line.message === "funktion.verweigert");
  return refused ? "seat" : "record";
}

describe("every person's server action", () => {
  it("is found at all, so the sweeps below sweep something", () => {
    assert.ok(PERSON_ACTION_FILES.length > 0, "no person action module was found");
  });

  /* An entry no server action module answers would stand ready for a module of that path, and claim
     a sweep over nothing meanwhile. */
  it("names a server action module at every entry of the lane table", () => {
    const served = new Set(ACTION_MODULES.map(srcPathOf));

    assert.deepEqual(
      [...PERSON_ACTION_MODULES].filter((module) => !served.has(module)),
      [],
    );
  });

  /* Two listings reached by different routes, the declaration above and what each export does,
     required to agree: a seat export sent through the record entry, or a record export through the
     seat entry, fails here by name. */
  it("runs behind the entry its declared claim names", async () => {
    const actions = await everyPersonAction();
    const ran = new Map<string, string>();
    for (const [name, action] of actions) ran.set(name, await entryOf(action));

    assert.deepEqual(ran, new Map([...actions.keys()].map((name) => [name, CLAIMS_A_RECORD.has(name) ? "record" : "seat"])));
    assert.deepEqual(
      [...CLAIMS_A_RECORD].filter((name) => !actions.has(name)),
      [],
      "a record claim named here is exported nowhere",
    );
  });

  /* The reader above held against one action of each kind, built on the two real entries: the tree may
     hold exports of one kind alone, where agreement over the tree cannot show the reader tells them apart. */
  it("tells the two entries apart", async () => {
    const seatAction: PersonAction = (argument) => runPersonMutation("seatSample", argument as typeof HELD, countingBody().body);
    const recordAction: PersonAction = () => runPersonRecordMutation("recordSample", countingBody().body);

    assert.deepEqual([await entryOf(seatAction), await entryOf(recordAction)], ["seat", "record"]);
  });

  /* Each export called, never its source read: an action outside `runPersonMutation`, or one the spine
     does not guard, validates the missing payload or reaches the backend, and answers something else. */
  it("answers a caller with no person's session through the spine's guard, before any work", async () => {
    setSubject(null);
    const { answers, sent } = await answersOf(await everyPersonAction(), undefined);

    assert.equal(sent, 0, "a person's action reached the network for a caller nobody signed in as");
    assert.deepEqual(answers, new Map([...answers.keys()].map((action) => [action, { success: false, error: KONTO_FORBIDDEN }])));
  });

  /* The seat the action claims is the one the spine derives and judges, never the caller's word: a
     person holding a seat on one team claims another's in the payload. */
  it("answers a claim on a seat the person does not hold with the lost seat's words, never reaching the network", async () => {
    const seatActions = new Map([...(await everyPersonAction())].filter(([name]) => !CLAIMS_A_RECORD.has(name)));
    setSubject(person({ sitze: [sitz()] }));
    const { answers, sent } = await answersOf(seatActions, { team_id: OTHER_TEAM, saison_id: SITZ.saison_id });

    assert.ok(seatActions.size > 0, "no export claims a seat, so nothing here is asked");
    assert.equal(sent, 0, "a person's action reached the network for a seat its caller does not hold");
    assert.deepEqual(answers, new Map([...answers.keys()].map((action) => [action, { success: false, error: SITZ_WEG }])));
  });
});

describe("the person spine's record entry", () => {
  it("turns away a caller with no person's session before the body runs, logging why", async () => {
    setSubject(null);
    const { ran, body } = countingBody();

    const answer = await runPersonRecordMutation("probeAction", body);

    assert.deepEqual(answer, { success: false, error: KONTO_FORBIDDEN });
    assert.equal(ran.count, 0, "the body ran for a caller nobody signed in as");
    assert.deepEqual(loggedLines, [
      { level: "info", message: "funktion.verweigert", meta: { operation: "probeAction", grund: "keine_sitzung" } },
    ]);
  });

  /* A withdrawal must reach a past season's seat and a retired record, which no Funktion carries: the
     entry judges the session alone, and the backend the record. */
  it("runs the body for a person holding no Funktion at all, under the person lane's actor", async () => {
    setSubject(person({ sitze: [sitz({ saison_status: "past" })] }));
    let lane: unknown;

    const answer = await runPersonRecordMutation("probeAction", () => {
      lane = getRequestActor()?.lane;
      return Promise.resolve({ success: true, message: "Gespeichert." });
    });

    assert.deepEqual(answer, { success: true, message: "Gespeichert." });
    assert.equal(lane, "person");
  });

  it("answers the backend's refusal of the record in the shared reader's words", async () => {
    setSubject(person());

    const answer = await runPersonRecordMutation("probeAction", () =>
      Promise.reject(refusedOn("PATCH /spieler/selbst/einwilligung", "REQ-FUNKTION-001")),
    );

    assert.deepEqual(answer, { success: false, error: SITZ_WEG });
  });

  it("answers a write of unknown outcome as unanswered, and refreshes", async () => {
    setSubject(person());

    const answer = await runPersonRecordMutation("probeAction", () => {
      recordWriteSent();
      markOutcomeUnknown();
      return Promise.resolve({ success: true, message: "Gespeichert." });
    });

    assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown", `a write of unknown outcome answered ${JSON.stringify(answer)}`);
    assert.equal(refreshes(), 1);
  });
});

describe("the person spine's seat check", () => {
  it("runs the body for a seat held at the claimed address, handing it that seat", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" })] }));
    let handed: unknown;

    const answer = await runPersonMutation("probeAction", HELD, (held) => {
      handed = held.seats.map((seat) => [seat.team_id, seat.saison_id, seat.rolle]);
      return Promise.resolve({ success: true, message: "Gespeichert." });
    });

    assert.deepEqual(answer, { success: true, message: "Gespeichert." });
    assert.deepEqual(handed, [[SITZ.team_id, SITZ.saison_id, "trainer"]]);
  });

  /* The person lane's actor, recorded by the lookup inside the scope the spine opened: the backend's
     person routes refuse a request naming nobody, and one naming the admin lane. */
  it("runs the body under the person lane's actor", async () => {
    setSubject(person({ sitze: [sitz()] }));
    let lane: unknown;

    await runPersonMutation("probeAction", HELD, () => {
      lane = getRequestActor()?.lane;
      return Promise.resolve({ success: true, message: "Gespeichert." });
    });

    assert.equal(lane, "person");
  });

  /* Both halves of the address, never the team alone, and a `past` season grants no seat at all. */
  for (const [label, seat] of [
    ["a seat on another team", sitz({ team_id: OTHER_TEAM })],
    ["a seat on the same team in another season", sitz({ saison_id: "2627", saison_status: "future" })],
    ["a seat at the address itself in a past season", sitz({ saison_status: "past" })],
  ] as const) {
    it(`refuses a person holding only ${label} before the body runs`, async () => {
      setSubject(person({ sitze: [seat] }));
      const { ran, body } = countingBody();

      const answer = await runPersonMutation("probeAction", HELD, body);

      assert.deepEqual(answer, { success: false, error: SITZ_WEG });
      assert.equal(ran.count, 0, "the body ran for a seat the person does not hold");
      assert.equal(refreshes(), 0, "a refused caller's page was refreshed");
    });
  }

  it("refuses a claim naming no address before the body runs", async () => {
    setSubject(person({ sitze: [sitz()] }));
    const { ran, body } = countingBody();

    // The argument a request can send an action, whatever the action's type says.
    const answer = await runPersonMutation("probeAction", undefined as unknown as typeof HELD, body);

    assert.deepEqual(answer, { success: false, error: SITZ_WEG });
    assert.equal(ran.count, 0, "the body ran for a claim naming no address");
  });

  /* One line per refusal, naming why and never whom: the address is the person's, and the log is read
     by whoever operates the stack. */
  it("logs one line naming the refusal's reason and nothing of the address", async () => {
    for (const [subject, grund] of [
      [null, "keine_sitzung"],
      [person({ sitze: [sitz({ team_id: OTHER_TEAM })] }), "kein_sitz"],
    ] as const) {
      setSubject(subject);
      loggedLines.length = 0;

      await runPersonMutation("probeAction", HELD, countingBody().body);

      assert.deepEqual(loggedLines, [{ level: "info", message: "funktion.verweigert", meta: { operation: "probeAction", grund: grund } }]);
      assert.ok(!JSON.stringify(loggedLines).includes("@"), "the refusal's line carries an address");
    }
  });
});

describe("what the person spine answers once its body ran", () => {
  /* A write that may have landed is neither a success nor a failure: a retry would repeat it
     (`docs/frontend/spec.md :: I366`). */
  it("answers a write of unknown outcome as unanswered, whatever the body answered, and refreshes", async () => {
    setSubject(person({ sitze: [sitz()] }));

    const answer = await runPersonMutation("probeAction", HELD, () => {
      recordWriteSent();
      markOutcomeUnknown();
      return Promise.resolve({ success: true, message: "Gespeichert." });
    });

    assert.equal("outcome" in answer ? answer.outcome : undefined, "unknown", `a write of unknown outcome answered ${JSON.stringify(answer)}`);
    assert.equal(refreshes(), 1);
  });

  it("refreshes the page after a write's success", async () => {
    setSubject(person({ sitze: [sitz()] }));

    await runPersonMutation("probeAction", HELD, () => {
      recordWriteSent();
      return Promise.resolve({ success: true, message: "Gespeichert." });
    });

    assert.equal(refreshes(), 1);
  });
});

describe("a person-tier read's scope", () => {
  it("runs the read under the person lane's actor", async () => {
    setSubject(person({ sitze: [sitz()] }));

    const actor = await runPersonRead(() => Promise.resolve(getRequestActor()));

    assert.equal(actor?.lane, "person");
  });

  /* Thrown rather than answered: a read has no failure value, and only a page skipping its own session
     check reaches this, which must be loud rather than a page that renders empty. */
  it("throws with no person signed in, the read never running", async () => {
    setSubject(null);
    let ran = 0;

    await assert.rejects(
      runPersonRead(() => {
        ran += 1;
        return Promise.resolve(undefined);
      }),
      PersonReadWithoutSubjectError,
    );
    assert.equal(ran, 0, "the read ran for a request nobody signed in to");
  });
});
