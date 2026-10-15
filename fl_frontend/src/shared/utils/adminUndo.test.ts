import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

import type { UndoReport } from "./adminUndo.ts";

/* The session, the refresh and the trace seed are the framework's, and the spine between them and the
   undo's body is what is driven. */
const { setSession, setRefusal } = doubleActionRequest();

const { replayRefusal, runAdminUndo } = await import("./adminUndo.ts");
const { invalidatesOnWrite, FORBIDDEN_BY_REFUSAL } = await import("./adminMutation.ts");
const { AENDERUNG_STEHT_WEITERHIN } = await import("./actionError.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
const { recordWriteSent } = await import("@/core/requestScope.ts");

/** The ruling's words for an undo nobody can tell landed. */
const RUECKNAHME_UNKLAR = "Ob die Änderung zurückgenommen wurde, ist unklar. Lade die Seite neu und prüfe sie.";

/** What the spine did to the caches and the page, by call. */
const cleared = (): string[] => cacheCalls.map(({ name, args }) => [name, ...args].join(" "));

/** One undo whose replay declares a tag and sends its write, then answers or throws as `report` does. */
const undo = (report: () => Promise<UndoReport>) =>
  runAdminUndo("undoProbe", () => {
    invalidatesOnWrite("probe");
    recordWriteSent();
    return report();
  });

describe("what the undo spine clears when a replay stops part-way", () => {
  /* The defect: a drop reached only past the refusal's own return never runs for those outcomes, so a
     cached fixture serves the pre-undo state for a day and a cached club for a week. */
  it("clears the caches and reads the page again before it reports a refusal", async () => {
    const answer = await undo(async () => ({ refusal: "Nur die Stammdaten wurden zurückgesetzt." }));

    assert.deepEqual(answer, { success: false, error: "Nur die Stammdaten wurden zurückgesetzt." }, "the refusal reaches the admin reworded");
    assert.deepEqual(
      cleared(),
      ["updateTag probe", "refresh"],
      "a restore that stopped part-way leaves the caches serving the rows it had written",
    );
  });

  it("clears them where the replay throws", async () => {
    const answer = await undo(async () => {
      throw new Error("the replay's second write failed");
    });

    assert.equal(answer.success, false, "a replay that threw is reported as landed");
    assert.deepEqual(cleared(), ["updateTag probe", "refresh"], "a replay that throws leaves the caches serving the rows it had written");
  });
});

describe("what the undo spine answers when nobody can tell whether its replay landed", () => {
  /* A replay is a write, and one throwing after it wrote leaves the row restored: answered as a
     failure, the admin undoes it a second time. The shared reader's sentence speaks of a save. */
  it("answers a throw of the replay's own code as of unknown outcome, in words about the undo", async () => {
    const answer = await undo(async () => {
      throw new RangeError("Invalid time value");
    });

    assert.deepEqual(answer, { success: false, error: RUECKNAHME_UNKLAR, outcome: "unknown" });
  });

  /* An unacknowledged write may still have landed too, and the slice's own sentence says what to check. */
  it("answers an unacknowledged replay as of unknown outcome, in the slice's own sentence", async () => {
    const answer = await undo(async () => ({ unclear: "Die Rücknahme wurde abgebrochen. Prüfe den Eintrag." }));

    assert.deepEqual(answer, { success: false, error: "Die Rücknahme wurde abgebrochen. Prüfe den Eintrag.", outcome: "unknown" });
    assert.deepEqual(cleared(), ["updateTag probe", "refresh"], "a write that may have landed leaves the caches serving what it replaced");
  });

  it("answers a restore that cost something with the restored sentence first, graded a warning", async () => {
    assert.deepEqual(await undo(async () => ({})), { success: true, message: "Die Änderung wurde zurückgenommen.", warn: false });
    assert.deepEqual(await undo(async () => ({ cost: "Ein Link ging raus." })), {
      success: true,
      message: "Die Änderung wurde zurückgenommen. Ein Link ging raus.",
      warn: true,
    });
  });
});

describe("who the undo spine answers before it does any work", () => {
  /* Each reason in the action's own words, so the save and its undo never word one condition two ways,
     and then that the change stands: the offer is gone, so the admin has to know nothing was taken back. */
  it("answers every reason its guard turns a caller away for in the action's sentence, and that the change stands", async () => {
    for (const [reason, sentence] of Object.entries(FORBIDDEN_BY_REFUSAL)) {
      setSession(null);
      setRefusal(reason as keyof typeof FORBIDDEN_BY_REFUSAL);
      cacheCalls.length = 0;
      let ran = 0;

      const answer = await runAdminUndo("undoProbe", async () => {
        ran += 1;
        return {};
      });

      assert.deepEqual(answer, { success: false, error: `${sentence} ${AENDERUNG_STEHT_WEITERHIN}` }, `the ${reason} arm`);
      assert.equal(ran, 0, `the ${reason} arm ran the replay`);
      assert.deepEqual(cacheCalls, [], `the ${reason} arm cleared a cache or read the page for a caller nobody authorized`);
    }
  });
});

/** A replayed endpoint's refusal, answered as `apiClient` raises it. */
const refused = (statusCode: number, serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend:8000/api/v0/x",
    endpoint: "/x",
    method: "PATCH",
    readOnly: false,
    traceId: "ab".repeat(16),
    statusCode,
    serverErrorCode,
  });

describe("the sentence a replay's refusal is worded with", () => {
  const TABLE = { "REQ-TEST-001": "Die Rücknahme wurde nicht ausgeführt." };

  /* Codes are unique across the API, so a rule moved to another status keeps its row. */
  it("answers the table's sentence for a refusal carrying one of its codes, at whatever status", () => {
    for (const status of [409, 422, 404, 410, 403]) {
      assert.equal(replayRefusal(refused(status, "REQ-TEST-001"), TABLE), TABLE["REQ-TEST-001"], String(status));
    }
  });

  // `undefined` is the action's cue to rethrow, so each of these reaches the spine as a failure.
  it("answers nothing for an unmapped code, a server error, or anything but a refusal", () => {
    assert.equal(replayRefusal(refused(409, "REQ-TEST-002"), TABLE), undefined, "an unmapped code was worded");
    // The replay may have landed behind a 5xx, which a refusal's "Die Änderung steht weiterhin." would deny.
    assert.equal(replayRefusal(refused(500, "REQ-TEST-001"), TABLE), undefined, "a server error was worded as a refusal");
    assert.equal(replayRefusal(new Error("network"), TABLE), undefined, "a thrown error that is no refusal was worded");
  });

  it("reads the table with `hasOwn`, so a code named for a prototype key is not a refusal", () => {
    assert.equal(replayRefusal(refused(409, "toString"), TABLE), undefined);
  });
});
